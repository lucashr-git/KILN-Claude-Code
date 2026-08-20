#!/usr/bin/env python3
"""
claude-metrics — mede tokens, custo e eficiência das suas sessões do Claude Code.

Lê os transcripts locais (~/.claude/projects/**/*.jsonl). Não manda nada para
lugar nenhum, não precisa de coletor, não gasta token.

  python3 claude-metrics.py                      # últimos 7 dias, relatório no terminal
  python3 claude-metrics.py --since 30           # últimos 30 dias
  python3 claude-metrics.py --html relatorio.html
  python3 claude-metrics.py --by-session

O custo em USD é o "equivalente de API": o que essas mesmas chamadas custariam
pagando por token. Na assinatura Max você não paga isso — o número serve para
comparar com alternativas que cobram por token (CrewAI, LangGraph, etc.).
"""
from __future__ import annotations
import argparse, json, os, sys, glob, html
from collections import defaultdict
from datetime import datetime, timedelta, timezone

# USD por milhão de tokens. Confira em platform.claude.com/docs/en/about-claude/pricing
PRICES = {
    "opus":   {"in": 5.00, "cache_w": 6.25, "cache_r": 0.50, "out": 25.00},
    "sonnet": {"in": 2.00, "cache_w": 2.50, "cache_r": 0.20, "out": 10.00},
    "haiku":  {"in": 1.00, "cache_w": 1.25, "cache_r": 0.10, "out":  5.00},
    "fable":  {"in":10.00, "cache_w":12.50, "cache_r": 1.00, "out": 50.00},
}
FAMILY_ORDER = ["opus", "fable", "sonnet", "haiku", "outro"]


def family(model: str) -> str:
    m = (model or "").lower()
    for f in ("opus", "fable", "mythos", "sonnet", "haiku"):
        if f in m:
            return "fable" if f == "mythos" else f
    return "outro"


def price(model: str, u: dict) -> float:
    p = PRICES.get(family(model))
    if not p:
        return 0.0
    return (u["in"] * p["in"] + u["cache_w"] * p["cache_w"]
            + u["cache_r"] * p["cache_r"] + u["out"] * p["out"]) / 1_000_000


def blank() -> dict:
    return {"in": 0, "out": 0, "cache_w": 0, "cache_r": 0, "msgs": 0}


def add(dst: dict, u: dict) -> None:
    for k in ("in", "out", "cache_w", "cache_r", "msgs"):
        dst[k] += u[k]


def total_in(u: dict) -> int:
    return u["in"] + u["cache_w"] + u["cache_r"]


def scan(root: str, since_days: int):
    cutoff = datetime.now(timezone.utc) - timedelta(days=since_days)
    rows = []
    for path in glob.glob(os.path.join(root, "**", "*.jsonl"), recursive=True):
        for line in open(path, errors="ignore"):
            try:
                o = json.loads(line)
            except Exception:
                continue
            if o.get("type") != "assistant":
                continue
            msg = o.get("message") or {}
            usage = msg.get("usage") or {}
            if not usage:
                continue
            ts = o.get("timestamp")
            when = None
            if ts:
                try:
                    when = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                except Exception:
                    pass
            if when and when < cutoff:
                continue
            rows.append({
                "session": o.get("sessionId") or "?",
                "agent": o.get("attributionAgent") or ("subagent" if o.get("isSidechain") else "main"),
                "sidechain": bool(o.get("isSidechain")),
                "agent_id": o.get("agentId"),
                "model": msg.get("model") or "?",
                "when": when,
                "u": {
                    "in": usage.get("input_tokens", 0) or 0,
                    "out": usage.get("output_tokens", 0) or 0,
                    "cache_w": usage.get("cache_creation_input_tokens", 0) or 0,
                    "cache_r": usage.get("cache_read_input_tokens", 0) or 0,
                    "msgs": 1,
                },
            })
    return rows


def aggregate(rows):
    by_model, by_agent, by_session = defaultdict(blank), defaultdict(blank), defaultdict(blank)
    by_agent_model = defaultdict(blank)
    per_sub = defaultdict(lambda: {"first_in": None, "out_total": 0, "read": 0, "model": "?", "agent": "?"})
    grand = blank()
    for r in rows:
        add(grand, r["u"]); add(by_model[r["model"]], r["u"])
        add(by_agent[r["agent"]], r["u"]); add(by_session[r["session"]], r["u"])
        add(by_agent_model[(r["agent"], r["model"])], r["u"])
        if r["sidechain"] and r["agent_id"]:
            s = per_sub[r["agent_id"]]
            s["agent"], s["model"] = r["agent"], r["model"]
            if s["first_in"] is None:
                s["first_in"] = total_in(r["u"])
            # conteúdo novo que ele ingeriu; cache_read é releitura do mesmo
            # prefixo a cada turno e inflaria a conta
            s["read"] += r["u"]["in"] + r["u"]["cache_w"]
            s["out_total"] += r["u"]["out"]
    return grand, by_model, by_agent, by_session, by_agent_model, per_sub


def fmt(n: int) -> str:
    if n >= 1_000_000: return f"{n/1_000_000:.1f}M"
    if n >= 1_000:     return f"{n/1_000:.1f}k"
    return str(n)


def bar(frac: float, w: int = 24) -> str:
    f = max(0, min(w, round(frac * w)))
    return "█" * f + "░" * (w - f)


def report(rows, by_session_flag=False):
    if not rows:
        print("Nenhuma sessão encontrada no período. Tente --since 90.")
        return
    grand, by_model, by_agent, by_session, by_agent_model, per_sub = aggregate(rows)
    cost_total = sum(price(m, u) for m, u in by_model.items())
    processed = total_in(grand) + grand["out"]

    print(f"\n\033[1mCLAUDE CODE · {len(by_session)} sessão(ões), {grand['msgs']} respostas\033[0m")
    print("─" * 66)
    print(f"  tokens processados   {fmt(processed):>10}")
    print(f"    entrada nova       {fmt(grand['in']):>10}")
    print(f"    cache escrito      {fmt(grand['cache_w']):>10}")
    print(f"    cache lido         {fmt(grand['cache_r']):>10}")
    print(f"    saída              {fmt(grand['out']):>10}")
    print(f"  equivalente de API   {'$%.2f' % cost_total:>10}   (na assinatura você não paga isso)")

    print("\n\033[1mPOR MODELO\033[0m")
    items = sorted(by_model.items(), key=lambda kv: -price(kv[0], kv[1]))
    for m, u in items:
        c = price(m, u)
        share = c / cost_total if cost_total else 0
        print(f"  {m[:34]:<34} {bar(share)} {share*100:4.0f}%  ${c:7.2f}  {fmt(total_in(u)+u['out']):>8}")

    print("\n\033[1mPOR AGENTE\033[0m")
    ag = defaultdict(float)
    for (a, m), u in by_agent_model.items():
        ag[a] += price(m, u)
    for a, c in sorted(ag.items(), key=lambda kv: -kv[1]):
        u = by_agent[a]
        share = c / cost_total if cost_total else 0
        tag = "janela principal" if a == "main" else "subagent"
        print(f"  {a[:26]:<26} {bar(share)} {share*100:4.0f}%  ${c:7.2f}  {fmt(total_in(u)+u['out']):>8}  {tag}")

    # ---- eficiência ----
    sub_cost = sum(c for a, c in ag.items() if a != "main")
    off_main = sub_cost / cost_total if cost_total else 0
    reads = grand["cache_r"]
    cache_rate = reads / (reads + grand["in"] + grand["cache_w"]) if (reads + grand["in"] + grand["cache_w"]) else 0

    print("\n\033[1mEFICIÊNCIA\033[0m")
    print(f"  trabalho fora da janela principal  {bar(off_main)} {off_main*100:4.0f}%")
    print(f"  aproveitamento de cache            {bar(cache_rate)} {cache_rate*100:4.0f}%")
    if per_sub:
        entradas = [s["first_in"] for s in per_sub.values() if s["first_in"]]
        lido = sum(s["read"] for s in per_sub.values())
        gerado = sum(s["out_total"] for s in per_sub.values())
        print(f"  subagents disparados               {len(per_sub)}")
        if entradas:
            print(f"  custo de entrada por delegação     {fmt(sum(entradas)//len(entradas))} tokens (média)")
        print(f"  conteúdo novo lido por eles        {fmt(lido)}")
        print(f"  texto que eles geraram             {fmt(gerado)}"
              + (f"   ({lido/gerado:.0f}× de compressão)" if gerado else ""))
    else:
        print("  subagents disparados               0  — você não está delegando nada")

    if by_session_flag:
        print("\n\033[1mPOR SESSÃO\033[0m")
        for s, u in sorted(by_session.items(), key=lambda kv: -(total_in(kv[1]) + kv[1]["out"]))[:15]:
            print(f"  {s[:36]:<36} {fmt(total_in(u)+u['out']):>9}  {u['msgs']:>4} msgs")
    print()


# --------------------------------------------------------------------------- HTML
SERIES = {"opus": ("#2a78d6", "#3987e5"), "fable": ("#4a3aa7", "#9085e9"),
          "sonnet": ("#eb6834", "#d95926"), "haiku": ("#1baf7a", "#199e70"),
          "outro": ("#eda100", "#c98500")}


def hbars(title, entries, total, note=""):
    """entries: [(label, value, family, extra)]"""
    if total <= 0:
        return ""
    out = [f'<section><h2>{html.escape(title)}</h2>']
    if note:
        out.append(f'<p class="note">{html.escape(note)}</p>')
    out.append('<div class="rows">')
    for label, value, fam, extra in entries:
        pct = value / total * 100
        out.append(
            f'<div class="row" title="{html.escape(label)}: {extra}">'
            f'<div class="lb">{html.escape(label)}</div>'
            f'<div class="track"><div class="fill" style="width:{max(pct,0.4):.2f}%;'
            f'background:var(--s-{fam})"></div></div>'
            f'<div class="val">{html.escape(extra)}</div></div>')
    out.append('</div></section>')
    return "".join(out)


def build_html(rows) -> str:
    grand, by_model, by_agent, by_session, by_agent_model, per_sub = aggregate(rows)
    cost_total = sum(price(m, u) for m, u in by_model.items()) or 1e-9
    processed = total_in(grand) + grand["out"]
    sub_cost = sum(price(m, u) for (a, m), u in by_agent_model.items() if a != "main")
    off_main = sub_cost / cost_total
    reads = grand["cache_r"]
    denom = reads + grand["in"] + grand["cache_w"]
    cache_rate = reads / denom if denom else 0

    model_rows = sorted(((m, price(m, u), family(m), u) for m, u in by_model.items()),
                        key=lambda t: -t[1])
    agent_cost = defaultdict(float); agent_fam = {}
    for (a, m), u in by_agent_model.items():
        agent_cost[a] += price(m, u); agent_fam.setdefault(a, family(m))
    agent_rows = sorted(agent_cost.items(), key=lambda kv: -kv[1])

    cards = [
        ("tokens processados", fmt(processed), f"{grand['msgs']} respostas"),
        ("equivalente de API", f"${cost_total:.2f}", "não é o que você paga no Max"),
        ("fora da janela principal", f"{off_main*100:.0f}%", f"{len(per_sub)} subagents"),
        ("aproveitamento de cache", f"{cache_rate*100:.0f}%", "quanto foi lido do cache"),
    ]

    legend = "".join(
        f'<span class="lg"><i style="background:var(--s-{f})"></i>{f}</span>'
        for f in FAMILY_ORDER if any(family(m) == f for m in by_model))

    body = [
        '<div class="cards">',
        *[f'<div class="card"><div class="k">{html.escape(k)}</div>'
          f'<div class="v">{html.escape(v)}</div><div class="s">{html.escape(s)}</div></div>'
          for k, v, s in cards],
        '</div>',
        f'<div class="legend">{legend}</div>',
        hbars("Custo por modelo", [(m, c, f, f"${c:.2f}") for m, c, f, _ in model_rows],
              cost_total, "equivalente de API, por milhão de tokens da tabela pública"),
        hbars("Custo por agente", [(a, c, agent_fam.get(a, "outro"), f"${c:.2f}")
                                   for a, c in agent_rows],
              cost_total, "'main' é a janela principal; o resto são subagents"),
    ]

    table = ['<section><h2>Tabela</h2><table><thead><tr><th>agente</th><th>modelo</th>'
             '<th>entrada</th><th>cache w</th><th>cache r</th><th>saída</th><th>USD</th>'
             '</tr></thead><tbody>']
    for (a, m), u in sorted(by_agent_model.items(), key=lambda kv: -price(kv[0][1], kv[1])):
        table.append(f'<tr><td>{html.escape(a)}</td><td>{html.escape(m)}</td>'
                     f'<td>{fmt(u["in"])}</td><td>{fmt(u["cache_w"])}</td>'
                     f'<td>{fmt(u["cache_r"])}</td><td>{fmt(u["out"])}</td>'
                     f'<td>${price(m,u):.2f}</td></tr>')
    table.append('</tbody></table></section>')

    return f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>claude-metrics</title><style>
 .viz-root{{color-scheme:light;--surface-1:#fcfcfb;--text-primary:#0b0b0b;
   --text-secondary:#52514e;--muted:#8a8781;--line:#e3e2de;
   --s-opus:#2a78d6;--s-fable:#4a3aa7;--s-sonnet:#eb6834;--s-haiku:#1baf7a;--s-outro:#eda100}}
 @media (prefers-color-scheme:dark){{:root:where(:not([data-theme=light])) .viz-root{{
   color-scheme:dark;--surface-1:#1a1a19;--text-primary:#fff;--text-secondary:#c3c2b7;
   --muted:#8a8781;--line:#2e2d2a;
   --s-opus:#3987e5;--s-fable:#9085e9;--s-sonnet:#d95926;--s-haiku:#199e70;--s-outro:#c98500}}}}
 body{{margin:0;background:var(--surface-1);color:var(--text-primary);
   font:14px/1.55 ui-sans-serif,-apple-system,"Segoe UI",sans-serif}}
 .viz-root{{max-width:860px;margin:0 auto;padding:34px 26px 60px}}
 h1{{font-size:19px;margin:0 0 3px}}
 .sub{{color:var(--muted);font-size:12.5px;margin:0 0 26px}}
 h2{{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);
   font-weight:600;margin:34px 0 6px}}
 .note{{color:var(--muted);font-size:12px;margin:0 0 12px}}
 .cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}}
 .card{{border:1px solid var(--line);border-radius:9px;padding:13px 15px}}
 .card .k{{font-size:11.5px;color:var(--muted)}}
 .card .v{{font-size:25px;font-weight:600;margin:2px 0;font-variant-numeric:tabular-nums}}
 .card .s{{font-size:11px;color:var(--muted)}}
 .legend{{margin:22px 0 0;font-size:12px;color:var(--text-secondary)}}
 .lg{{margin-right:15px;white-space:nowrap}}
 .lg i{{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px}}
 .rows{{display:flex;flex-direction:column;gap:7px}}
 .row{{display:grid;grid-template-columns:170px 1fr 74px;align-items:center;gap:11px}}
 .lb{{font-size:12px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;
   white-space:nowrap}}
 .track{{height:11px;background:var(--line);border-radius:4px;overflow:hidden}}
 .fill{{height:100%;border-radius:0 4px 4px 0}}
 .val{{font-size:12px;text-align:right;font-variant-numeric:tabular-nums;
   color:var(--text-secondary)}}
 table{{border-collapse:collapse;width:100%;font-size:12px;margin-top:6px}}
 th{{text-align:left;color:var(--muted);font-weight:500;border-bottom:1px solid var(--line);
   padding:6px 8px 6px 0}}
 td{{padding:5px 8px 5px 0;border-bottom:1px solid var(--line);
   font-variant-numeric:tabular-nums;color:var(--text-secondary)}}
 td:first-child{{color:var(--text-primary)}}
</style></head><body><div class="viz-root">
<h1>claude-metrics</h1>
<p class="sub">{len(by_session)} sessão(ões) · gerado a partir dos transcripts locais · nada saiu da máquina</p>
{''.join(body)}
{''.join(table)}
</div></body></html>"""


def main():
    ap = argparse.ArgumentParser(description="métricas locais do Claude Code")
    ap.add_argument("--root", default=os.path.expanduser("~/.claude/projects"))
    ap.add_argument("--since", type=int, default=7, help="janela em dias (padrão 7)")
    ap.add_argument("--html", metavar="ARQUIVO", help="também escreve um relatório HTML")
    ap.add_argument("--by-session", action="store_true")
    a = ap.parse_args()

    if not os.path.isdir(a.root):
        sys.exit(f"não achei {a.root} — passe --root")
    rows = scan(a.root, a.since)
    report(rows, a.by_session)
    if a.html:
        if not rows:
            sys.exit("sem dados para o HTML")
        open(a.html, "w").write(build_html(rows))
        print(f"HTML escrito em {a.html}\n")


if __name__ == "__main__":
    main()
