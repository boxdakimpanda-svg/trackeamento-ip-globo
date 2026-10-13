import { useEffect, useMemo, useState } from "react";
import { getCampaign, getConfig, registerVisit } from "./api";
import type { AppConfig, Campaign } from "./types";

type Result = Awaited<ReturnType<typeof registerVisit>>;

export default function TrackingPage() {
  const campaign = useMemo(() => decodeURIComponent(window.location.pathname.split("/").filter(Boolean)[1] || "direto"), []);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [campaignInfo, setCampaignInfo] = useState<Campaign | null>(null);
  const [includeLocation, setIncludeLocation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    getConfig().then(setConfig).catch((reason) => setError(reason.message));
    getCampaign(campaign).then(setCampaignInfo).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!result?.redirectUrl) return;
    const timer = window.setTimeout(() => window.location.assign(result.redirectUrl as string), 2_200);
    return () => window.clearTimeout(timer);
  }, [result]);

  const authorize = async () => {
    if (!config) return;
    setSubmitting(true);
    setError("");
    setStatus(includeLocation ? "Solicitando sua localização…" : "Registrando sua escolha…");
    try {
      let coordinates: { latitude?: number; longitude?: number } = {};
      if (includeLocation) {
        try {
          const position = await getPosition();
          coordinates = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        } catch {
          setStatus("A localização não foi liberada. Continuando somente com dados aproximados do IP…");
        }
      }
      const saved = await registerVisit({
        consent: true,
        privacyVersion: config.privacyVersion,
        campaign,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        referrer: document.referrer,
        language: navigator.language,
        screen: `${window.screen.width}x${window.screen.height}`,
        eventKind: "click",
        utm: campaignParameters(),
        ...coordinates,
      });
      setResult(saved);
      setStatus("");
    } catch (reason) {
      setError((reason as Error).message);
      setStatus("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="consent-page">
      <div className="consent-background" />
      <header className="consent-header">
        <BrandMark />
        <span className="secure-pill"><i /> CONEXÃO SEGURA</span>
      </header>

      {result ? (
        <section className="consent-card success-card">
          <div className="success-symbol">✓</div>
          <span className="eyebrow">REGISTRO CONCLUÍDO</span>
          <h1>Obrigado pela transparência.</h1>
          <p>Sua visita entrou na campanha <strong>{campaign}</strong> com os limites informados.</p>
          <div className="receipt-grid">
            <div><span>IP armazenado</span><strong>{result.ipMasked}</strong></div>
            <div><span>Local aproximado</span><strong>{[result.location.city, result.location.region, result.location.country].filter(Boolean).join(", ") || "Indisponível"}</strong></div>
            <div><span>Fonte</span><strong>{result.location.source === "browser-consent" ? "Localização autorizada" : result.location.source === "ip-approximate" ? "Estimativa por IP" : "Sem coordenadas"}</strong></div>
            <div><span>Retenção máxima</span><strong>{result.retentionDays} dias</strong></div>
          </div>
          {result.redirectUrl && <a className="primary-button consent-redirect" href={result.redirectUrl}>Continuar para {campaignInfo?.destinationHost || "o funil"} →</a>}
          {result.redirectUrl && <p className="receipt-note">Redirecionando automaticamente em instantes…</p>}
          <p className="receipt-note">O IP completo não foi gravado. Esta página pode ser fechada com segurança.</p>
        </section>
      ) : (
        <section className="consent-card">
          <div className="consent-index">ATLAS // CONSENTIMENTO</div>
          <span className="eyebrow">ANÁLISE DE ACESSO</span>
          <h1>Você controla o que compartilha.</h1>
          <p className="consent-lead">
            Esta página registra uma visita para a campanha <strong>{campaign}</strong>. Antes de continuar, veja exatamente o que entra na análise.
          </p>
          {campaignInfo?.destinationHost && <div className="destination-note">Após confirmar, você seguirá para <strong>{campaignInfo.destinationHost}</strong>.</div>}

          <div className="data-disclosure">
            <div><span className="disclosure-icon">◈</span><div><strong>IP mascarado</strong><p>O servidor recebe o IP pela conexão, mas grava apenas uma versão parcial e um identificador criptográfico.</p></div><span className="required-tag">ESSENCIAL</span></div>
            <div><span className="disclosure-icon">⌁</span><div><strong>Contexto técnico</strong><p>Tipo de dispositivo, navegador, sistema, campanha, horário e origem do acesso.</p></div><span className="required-tag">ESSENCIAL</span></div>
            <div><span className="disclosure-icon">◎</span><div><strong>Localização do navegador</strong><p>Opcional. Se autorizada pelo seu navegador, as coordenadas são arredondadas para reduzir a precisão.</p></div><span className="optional-tag">OPCIONAL</span></div>
          </div>

          <label className="location-choice">
            <input type="checkbox" checked={includeLocation} onChange={(event) => setIncludeLocation(event.target.checked)} />
            <span className="custom-check">✓</span>
            <span><strong>Incluir minha localização aproximada</strong><small>O navegador ainda pedirá sua permissão.</small></span>
          </label>

          {error && <div className="notice notice-error">{error}</div>}
          {status && <div className="notice">{status}</div>}
          <button className="primary-button consent-button" onClick={authorize} disabled={submitting || !config}>
            {submitting ? "Processando…" : "Concordar e continuar"} <span>→</span>
          </button>
          <p className="consent-legal">Ao continuar, você concorda com este registro específico. Os dados são excluídos em até {config?.retentionDays || 30} dias.</p>
        </section>
      )}
      <footer className="consent-footer"><span>ATLAS IP</span><span>PRIVACIDADE POR PADRÃO</span><span>v1.0</span></footer>
    </main>
  );
}

function getPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Geolocalização indisponível"));
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 8_000,
      maximumAge: 300_000,
    });
  });
}

function campaignParameters() {
  const query = new URLSearchParams(window.location.search);
  return {
    source: query.get("utm_source") || "",
    medium: query.get("utm_medium") || "",
    campaign: query.get("utm_campaign") || "",
    content: query.get("utm_content") || "",
    term: query.get("utm_term") || "",
  };
}

function BrandMark() {
  return (
    <div className="brand">
      <svg viewBox="0 0 46 46" aria-hidden="true"><path d="M23 3 40 12.5v21L23 43 6 33.5v-21L23 3Z" /><circle cx="23" cy="23" r="8" /><path d="m10 15 13 8 13-8M23 23v15" /></svg>
      <div><strong>ATLAS</strong><span>IP INTELLIGENCE</span></div>
    </div>
  );
}
