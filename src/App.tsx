import { FormEvent, lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, getConfig, getDashboard, lookupIp, saveCampaign } from "./api";
import type { AppConfig, DashboardData, LookupResult, Visit } from "./types";

const AtlasMap = lazy(() => import("./AtlasMap").then((module) => ({ default: module.AtlasMap })));

type View = "overview" | "visits" | "tools" | "privacy";

const emptyDashboard: DashboardData = {
  summary: { total: 0, uniqueVisitors: 0, countries: 0, today: 0 },
  visits: [],
  countries: [],
  daily: [],
  campaigns: [],
  rangeDays: 30,
  generatedAt: new Date(0).toISOString(),
};

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [token, setToken] = useState(() => sessionStorage.getItem("atlas-admin-token") || "");
  const [authenticated, setAuthenticated] = useState(false);
  const [data, setData] = useState<DashboardData>(emptyDashboard);
  const [days, setDays] = useState(30);
  const [view, setView] = useState<View>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getConfig()
      .then((result) => {
        setConfig(result);
        if (!token && result.developmentTokenHint) setToken(result.developmentTokenHint);
      })
      .catch((reason) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadDashboard = useCallback(
    async (candidate = token, quiet = false) => {
      if (!candidate) return;
      if (!quiet) setLoading(true);
      try {
        const result = await getDashboard(candidate, days);
        setData(result);
        setAuthenticated(true);
        setError("");
        sessionStorage.setItem("atlas-admin-token", candidate);
      } catch (reason) {
        const apiError = reason as ApiError;
        if (apiError.status === 401) {
          setAuthenticated(false);
          sessionStorage.removeItem("atlas-admin-token");
        }
        setError(apiError.message);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [days, token],
  );

  useEffect(() => {
    if (token && config) loadDashboard(token);
  }, [config, days]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setInterval(() => loadDashboard(token, true), 30_000);
    return () => window.clearInterval(timer);
  }, [authenticated, loadDashboard, token]);

  const signOut = () => {
    sessionStorage.removeItem("atlas-admin-token");
    setAuthenticated(false);
    setToken("");
    setData(emptyDashboard);
  };

  if (!authenticated) {
    return (
      <Login
        config={config}
        token={token}
        setToken={setToken}
        onSubmit={() => loadDashboard(token)}
        loading={loading}
        error={error}
      />
    );
  }

  return (
    <div className="app-shell">
      <Sidebar view={view} setView={setView} signOut={signOut} />
      <main className="dashboard-main">
        <header className="topbar">
          <div>
            <span className="eyebrow">CENTRAL DE INTELIGÊNCIA</span>
            <h1>{viewTitle(view)}</h1>
          </div>
          <div className="topbar-actions">
            <label className="period-selector">
              <span>Período</span>
              <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
                <option value={1}>Hoje</option>
                <option value={7}>7 dias</option>
                <option value={30}>30 dias</option>
                <option value={90}>90 dias</option>
              </select>
            </label>
            <button className="icon-button" onClick={() => loadDashboard(token)} aria-label="Atualizar dados">
              ↻
            </button>
            <div className="operator-avatar">OP</div>
          </div>
        </header>

        {error && <div className="notice notice-error">{error}</div>}
        {view === "overview" && <Overview data={data} loading={loading} />}
        {view === "visits" && <VisitsPanel visits={data.visits} />}
        {view === "tools" && <Tools token={token} config={config} />}
        {view === "privacy" && <Privacy config={config} />}
      </main>
    </div>
  );
}

function Login({
  config,
  token,
  setToken,
  onSubmit,
  loading,
  error,
}: {
  config: AppConfig | null;
  token: string;
  setToken: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
  error: string;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <main className="login-page">
      <div className="login-grid" />
      <section className="login-copy">
        <Brand large />
        <span className="eyebrow">GEOINTELLIGENCE PLATFORM</span>
        <h1>Transforme acessos em contexto.</h1>
        <p>
          Acompanhe visitas consentidas em um globo vivo, entenda origem, dispositivo e campanha — sem armazenar o IP completo.
        </p>
        <div className="login-signal"><span /> SISTEMA OPERACIONAL</div>
      </section>
      <form className="login-card" onSubmit={submit}>
        <div className="login-card-head">
          <span className="terminal-mark">//</span>
          <div>
            <span className="eyebrow">ACESSO RESTRITO</span>
            <h2>Painel do operador</h2>
          </div>
        </div>
        {!config?.adminConfigured && !loading && (
          <div className="notice notice-error">Defina ATLAS_ADMIN_TOKEN no servidor para proteger o painel.</div>
        )}
        <label className="field-label" htmlFor="admin-token">Chave administrativa</label>
        <div className="input-shell">
          <span>⌁</span>
          <input
            id="admin-token"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Insira sua chave"
            autoComplete="current-password"
          />
        </div>
        {config?.development && config.developmentTokenHint && (
          <p className="field-hint">Ambiente local: a chave de desenvolvimento já foi preenchida.</p>
        )}
        {error && <div className="notice notice-error">{error}</div>}
        <button className="primary-button" disabled={loading || !token}>
          {loading ? "Autenticando…" : "Entrar no Atlas"} <span>→</span>
        </button>
        <p className="login-footnote">O token fica somente nesta aba e não é gravado no banco.</p>
      </form>
    </main>
  );
}

function Sidebar({ view, setView, signOut }: { view: View; setView: (view: View) => void; signOut: () => void }) {
  const entries: Array<{ id: View; icon: string; label: string }> = [
    { id: "overview", icon: "◉", label: "Visão geral" },
    { id: "visits", icon: "⌁", label: "Visitas" },
    { id: "tools", icon: "◇", label: "Ferramentas" },
    { id: "privacy", icon: "▱", label: "Privacidade" },
  ];
  return (
    <aside className="sidebar">
      <Brand />
      <nav>
        <span className="nav-caption">OPERAÇÕES</span>
        {entries.map((entry) => (
          <button key={entry.id} className={view === entry.id ? "active" : ""} onClick={() => setView(entry.id)}>
            <span>{entry.icon}</span>{entry.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-status">
        <div className="status-line"><span /> Coleta ativa</div>
        <small>Dados minimizados<br />Retenção automática</small>
      </div>
      <button className="signout-button" onClick={signOut}>↳ Sair do painel</button>
    </aside>
  );
}

function Overview({ data, loading }: { data: DashboardData; loading: boolean }) {
  const maxCountry = Math.max(...data.countries.map((item) => item.visits), 1);
  return (
    <div className={loading ? "content-grid is-loading" : "content-grid"}>
      <section className="metrics-row">
        <Metric label="VISITAS NO PERÍODO" value={data.summary.total} delta="dados consentidos" icon="⌁" />
        <Metric label="VISITANTES ÚNICOS" value={data.summary.uniqueVisitors} delta="identificador anônimo" icon="◎" />
        <Metric label="PAÍSES" value={data.summary.countries} delta="localização aproximada" icon="◇" />
        <Metric label="VISITAS HOJE" value={data.summary.today} delta="atualização automática" icon="↗" />
      </section>

      <Suspense fallback={<section className="panel atlas-map-panel map-module-loading"><i /><span>Carregando o globo interativo…</span></section>}>
        <AtlasMap visits={data.visits} />
      </Suspense>

      <section className="panel trend-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">VOLUME</span><h2>Atividade</h2></div>
          <span className="panel-meta">{data.rangeDays} DIAS</span>
        </div>
        <ActivityChart daily={data.daily} />
      </section>

      <section className="panel countries-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">ORIGENS</span><h2>Países principais</h2></div>
        </div>
        {data.countries.length ? data.countries.map((item, index) => (
          <div className="country-row" key={`${item.countryCode}-${item.country}`}>
            <span className="country-rank">{String(index + 1).padStart(2, "0")}</span>
            <span className="flag-token">{item.countryCode || "--"}</span>
            <div className="country-name"><strong>{item.country}</strong><span><i style={{ width: `${(item.visits / maxCountry) * 100}%` }} /></span></div>
            <b>{item.visits}</b>
          </div>
        )) : <EmptyState compact text="As origens aparecerão após a primeira visita." />}
      </section>

      <section className="panel feed-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">FLUXO RECENTE</span><h2>Últimas visitas</h2></div>
          <span className="live-label"><i /> AO VIVO</span>
        </div>
        <VisitFeed visits={data.visits.slice(0, 6)} />
      </section>
    </div>
  );
}

function Metric({ label, value, delta, icon }: { label: string; value: number; delta: string; icon: string }) {
  return (
    <article className="metric-card">
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{new Intl.NumberFormat("pt-BR").format(value)}</strong>
      <small><i /> {delta}</small>
    </article>
  );
}

function ActivityChart({ daily }: { daily: DashboardData["daily"] }) {
  if (!daily.length) return <EmptyState text="A curva de atividade será exibida quando houver visitas." />;
  const width = 580;
  const height = 210;
  const max = Math.max(...daily.map((entry) => entry.visits), 1);
  const points = daily.map((entry, index) => ({
    ...entry,
    x: daily.length === 1 ? width / 2 : 20 + (index / (daily.length - 1)) * (width - 40),
    y: height - 32 - (entry.visits / max) * (height - 62),
  }));
  const line = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const area = `${line} L${points.at(-1)?.x},${height - 30} L${points[0].x},${height - 30} Z`;
  return (
    <div className="activity-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Visitas por dia">
        <defs>
          <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5fffd4" stopOpacity=".28" />
            <stop offset="1" stopColor="#5fffd4" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((position) => <line key={position} className="chart-gridline" x1="20" y1={position * 160} x2={width - 20} y2={position * 160} />)}
        <path className="chart-area" d={area} />
        <path className="chart-line" d={line} />
        {points.map((point) => <circle key={point.day} className="chart-point" cx={point.x} cy={point.y} r="4"><title>{`${formatDay(point.day)}: ${point.visits}`}</title></circle>)}
      </svg>
      <div className="chart-labels">
        <span>{formatDay(points[0].day)}</span>
        <span>{formatDay(points[Math.floor(points.length / 2)].day)}</span>
        <span>{formatDay(points.at(-1)?.day || "")}</span>
      </div>
    </div>
  );
}

function VisitFeed({ visits }: { visits: Visit[] }) {
  if (!visits.length) return <EmptyState compact text="Nenhuma visita registrada neste período." />;
  return (
    <div className="visit-feed">
      {visits.map((visit) => (
        <div className="feed-row" key={visit.id}>
          <span className="feed-dot" />
          <div><strong>{locationName(visit)}</strong><small>{visit.ipMasked} · {visit.device} / {visit.browser}</small></div>
          <span className="campaign-tag">{visit.campaign}</span>
          <time>{relativeTime(visit.createdAt)}</time>
        </div>
      ))}
    </div>
  );
}

function VisitsPanel({ visits }: { visits: Visit[] }) {
  const [query, setQuery] = useState("");
  const filtered = visits.filter((visit) => JSON.stringify(visit).toLowerCase().includes(query.toLowerCase()));
  return (
    <section className="panel table-panel standalone-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">REGISTROS MINIMIZADOS</span><h2>Visitas recentes</h2></div>
        <div className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrar visitas" /></div>
      </div>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead><tr><th>Horário</th><th>Local</th><th>IP mascarado</th><th>Dispositivo</th><th>Campanha</th><th>Fonte</th></tr></thead>
          <tbody>
            {filtered.map((visit) => (
              <tr key={visit.id}>
                <td><strong>{formatDateTime(visit.createdAt)}</strong><small>{visit.timezone}</small></td>
                <td><strong>{locationName(visit)}</strong><small>{visit.countryCode}</small></td>
                <td className="mono">{visit.ipMasked}</td>
                <td><strong>{visit.device}</strong><small>{visit.os} · {visit.browser}</small></td>
                <td><span className="campaign-tag">{visit.campaign}</span></td>
                <td><span className={`source-tag source-${visit.locationSource}`}>{sourceLabel(visit.locationSource)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <EmptyState text="Nenhum registro corresponde ao filtro." />}
      </div>
    </section>
  );
}

function Tools({ token, config }: { token: string; config: AppConfig | null }) {
  const [campaign, setCampaign] = useState("Campanha principal");
  const [destinationUrl, setDestinationUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [campaignStatus, setCampaignStatus] = useState("");
  const [savingCampaign, setSavingCampaign] = useState(false);
  const [ip, setIp] = useState("");
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [looking, setLooking] = useState(false);
  const safeCampaign = campaign.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "direto";
  const link = `${window.location.origin}/t/${safeCampaign}`;

  const copy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  const persistCampaign = async () => {
    setSavingCampaign(true);
    setCampaignStatus("");
    try {
      const result = await saveCampaign(token, { name: campaign, slug: safeCampaign, destinationUrl });
      setCampaignStatus(`Campanha ativa. O link redireciona para ${result.campaign.destinationHost}.`);
    } catch (reason) {
      setCampaignStatus((reason as Error).message);
    } finally {
      setSavingCampaign(false);
    }
  };
  const submitLookup = async (event: FormEvent) => {
    event.preventDefault();
    setLooking(true);
    setLookupError("");
    try { setLookup(await lookupIp(token, ip)); }
    catch (reason) { setLookupError((reason as Error).message); setLookup(null); }
    finally { setLooking(false); }
  };

  return (
    <div className="tools-grid standalone-panel">
      <section className="panel tool-card link-builder">
        <span className="tool-number">01</span><span className="eyebrow">LINK CONSENTIDO</span>
        <h2>Crie uma campanha</h2>
        <p>Quem abrir o link verá a finalidade e escolherá quais dados compartilhar antes do registro.</p>
        <label className="field-label" htmlFor="campaign">Nome da campanha</label>
        <div className="input-shell"><span>#</span><input id="campaign" value={campaign} onChange={(event) => setCampaign(event.target.value)} /></div>
        <label className="field-label" htmlFor="destination">URL de destino do funil</label>
        <div className="input-shell"><span>↗</span><input id="destination" value={destinationUrl} onChange={(event) => setDestinationUrl(event.target.value)} placeholder="https://seu-funil.com/oferta" /></div>
        <button className="primary-button campaign-save" onClick={persistCampaign} disabled={savingCampaign || !campaign || !destinationUrl}>{savingCampaign ? "Salvando…" : "Salvar campanha"}</button>
        {campaignStatus && <div className="notice">{campaignStatus}</div>}
        <div className="generated-link"><code>{link}</code><button onClick={copy}>{copied ? "Copiado" : "Copiar"}</button></div>
        <a className="secondary-button" href={`/t/${safeCampaign}`} target="_blank" rel="noreferrer">Abrir página de consentimento ↗</a>
      </section>

      <section className="panel tool-card lookup-card">
        <span className="tool-number">02</span><span className="eyebrow">GEOLOCALIZAÇÃO APROXIMADA</span>
        <h2>Consulte um IP público</h2>
        <p>A consulta mostra cidade e coordenadas estimadas pelo provedor; ela nunca representa um endereço exato.</p>
        <form onSubmit={submitLookup}>
          <label className="field-label" htmlFor="ip-lookup">Endereço IPv4 ou IPv6</label>
          <div className="inline-form"><div className="input-shell"><span>⌕</span><input id="ip-lookup" value={ip} onChange={(event) => setIp(event.target.value)} placeholder="8.8.8.8" /></div><button className="primary-button" disabled={looking || !ip}>{looking ? "…" : "Consultar"}</button></div>
        </form>
        {lookupError && <div className="notice notice-error">{lookupError}</div>}
        {lookup && (
          <div className="lookup-result">
            <div><span>IP</span><strong className="mono">{lookup.ipMasked}</strong></div>
            <div><span>LOCAL</span><strong>{[lookup.city, lookup.region, lookup.country].filter(Boolean).join(", ") || "Não identificado"}</strong></div>
            <div><span>COORDENADAS</span><strong className="mono">{lookup.latitude ?? "—"}, {lookup.longitude ?? "—"}</strong></div>
            <small>Resultado aproximado. Não use para identificar residência ou pessoa.</small>
          </div>
        )}
      </section>

      <section className="panel tool-card operational-card">
        <span className="tool-number">03</span><span className="eyebrow">CONFIGURAÇÃO</span>
        <h2>Estado operacional</h2>
        <div className="check-list">
          <div><i className="ok">✓</i><span><strong>Painel protegido</strong><small>Token validado no servidor</small></span></div>
          <div><i className="ok">✓</i><span><strong>IP minimizado</strong><small>Somente versão mascarada no banco</small></span></div>
          <div><i className="ok">✓</i><span><strong>Retenção ativa</strong><small>Exclusão após {config?.retentionDays || 30} dias</small></span></div>
        </div>
      </section>
    </div>
  );
}

function Privacy({ config }: { config: AppConfig | null }) {
  return (
    <div className="privacy-grid standalone-panel">
      <section className="panel privacy-hero">
        <span className="eyebrow">PRIVACIDADE POR PADRÃO</span>
        <h2>Contexto útil, exposição mínima.</h2>
        <p>O Atlas foi desenhado para análise própria e autorizada. Cada visita exige uma ação clara da pessoa antes de entrar no painel.</p>
        <div className="privacy-score"><strong>0</strong><span>IPs completos<br />armazenados</span></div>
      </section>
      <section className="panel principles">
        <h2>Como os dados são tratados</h2>
        <div className="principle"><b>01</b><div><strong>Consentimento visível</strong><p>A página explica a finalidade e permite continuar com ou sem a localização do navegador.</p></div></div>
        <div className="principle"><b>02</b><div><strong>Minimização</strong><p>O IP é transformado em identificador criptográfico e mascarado antes da gravação.</p></div></div>
        <div className="principle"><b>03</b><div><strong>Prazo limitado</strong><p>Os registros são removidos automaticamente após {config?.retentionDays || 30} dias.</p></div></div>
        <div className="principle"><b>04</b><div><strong>Localização honesta</strong><p>Geolocalização por IP é sempre aproximada; coordenadas do navegador são reduzidas para duas casas decimais.</p></div></div>
      </section>
      <section className="panel privacy-note">
        <span className="eyebrow">ANTES DE PUBLICAR</span>
        <h2>Adapte o aviso à sua operação.</h2>
        <p>Inclua sua identidade, canal de contato, base legal e regras locais aplicáveis. O produto técnico não substitui sua política de privacidade.</p>
      </section>
    </div>
  );
}

function Brand({ large = false }: { large?: boolean }) {
  return (
    <div className={large ? "brand brand-large" : "brand"}>
      <svg viewBox="0 0 46 46" aria-hidden="true"><path d="M23 3 40 12.5v21L23 43 6 33.5v-21L23 3Z" /><circle cx="23" cy="23" r="8" /><path d="m10 15 13 8 13-8M23 23v15" /></svg>
      <div><strong>ATLAS</strong><span>IP INTELLIGENCE</span></div>
    </div>
  );
}

function EmptyState({ text, compact = false }: { text: string; compact?: boolean }) {
  return <div className={compact ? "empty-state compact" : "empty-state"}><span>◇</span><p>{text}</p></div>;
}

function viewTitle(view: View) {
  return ({ overview: "Visão geral", visits: "Registro de visitas", tools: "Ferramentas", privacy: "Privacidade" })[view];
}

function formatDay(day: string) {
  if (!day) return "";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "agora";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

function locationName(visit: Visit) {
  return [visit.city, visit.region, visit.country].filter(Boolean).join(", ") || "Local não identificado";
}

function sourceLabel(source: Visit["locationSource"]) {
  if (source === "browser-consent") return "Navegador";
  if (source === "ip-approximate") return "IP aproximado";
  return "Indisponível";
}
