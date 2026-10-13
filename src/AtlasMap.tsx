import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { LngLatBounds, Map as MapLibreMap, type StyleSpecification } from "maplibre-gl";
import brazilStates from "./data/brazil-states.json";
import usStates from "./data/us-states.json";
import type { Visit } from "./types";

type StyleMode = "auto" | "satellite" | "streets";
type GeoFeature = {
  type: "Feature";
  id?: string;
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
};

const brazilRegions: Record<string, string[]> = {
  Norte: ["AC", "AP", "AM", "PA", "RO", "RR", "TO"],
  Nordeste: ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
  "Centro-Oeste": ["DF", "GO", "MT", "MS"],
  Sudeste: ["ES", "MG", "RJ", "SP"],
  Sul: ["PR", "RS", "SC"],
};

const regionColors: Record<string, string> = {
  Norte: "#42cfa9",
  Nordeste: "#e5b967",
  "Centro-Oeste": "#ae96e8",
  Sudeste: "#62bdf4",
  Sul: "#ef9ba4",
};

const localFallbackStyle: StyleSpecification = {
  version: 8,
  name: "Atlas local fallback",
  sources: {},
  layers: [{
    id: "atlas-ocean",
    type: "background",
    paint: { "background-color": "#071620" },
  }],
};

export function AtlasMap({ visits }: { visits: Visit[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const visitsRef = useRef(visits);
  visitsRef.current = visits;
  const [ready, setReady] = useState(false);
  const [styleMode, setStyleMode] = useState<StyleMode>("auto");
  const [terrain, setTerrain] = useState(false);
  const [tilted, setTilted] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [zoom, setZoom] = useState(0.55);
  const [status, setStatus] = useState("Preparando a Terra e as camadas do mapa…");
  const [selected, setSelected] = useState<Visit | null>(visits[0] || null);
  const [country, setCountry] = useState<"BR" | "US">("BR");
  const [stateId, setStateId] = useState("");
  const [region, setRegion] = useState("");
  const [areaTitle, setAreaTitle] = useState("Visão global");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ displayName: string; latitude: number; longitude: number; type: string }>>([]);
  const [searching, setSearching] = useState(false);
  const spinFrame = useRef(0);

  const borders = useMemo(() => {
    const features: GeoFeature[] = [];
    for (const raw of (brazilStates as { features: GeoFeature[] }).features) {
      const code = String(raw.properties.sigla || "");
      const macro = Object.keys(brazilRegions).find((name) => brazilRegions[name].includes(code)) || "";
      features.push({
        ...raw,
        id: `BR-${code || features.length}`,
        properties: {
          name: raw.properties.name,
          code,
          country: "BR",
          macro,
          color: regionColors[macro] || "#73bce2",
        },
      });
    }
    for (const raw of (usStates as { features: GeoFeature[] }).features) {
      features.push({
        ...raw,
        id: `US-${features.length}`,
        properties: {
          name: raw.properties.name,
          code: "",
          country: "US",
          macro: "",
          color: "#74bce0",
        },
      });
    }
    return { type: "FeatureCollection" as const, features };
  }, []);

  const mapVisits = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: visits
      .filter((visit) => visit.latitude !== null && visit.longitude !== null)
      .map((visit) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [visit.longitude as number, visit.latitude as number] },
        properties: { id: visit.id, kind: "pageview", title: visit.city || visit.country },
      })),
  }), [visits]);

  const stopSpin = () => {
    cancelAnimationFrame(spinFrame.current);
    setSpinning(false);
  };

  useEffect(() => {
    if (!selected && visits.length) setSelected(visits[0]);
  }, [selected, visits]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [-42, -8],
      zoom: 0.55,
      minZoom: 0,
      maxZoom: 19,
      maxPitch: 60,
      attributionControl: { compact: true },
      renderWorldCopies: false,
      dragRotate: true,
    });
    mapRef.current = map;
    map.scrollZoom.setWheelZoomRate(0.006);
    map.scrollZoom.setZoomRate(0.02);
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: "metric" }), "bottom-left");

    let usableStyleLoaded = false;
    let localFallbackActive = false;

    map.on("style.load", () => {
      try {
        usableStyleLoaded = true;
        map.setProjection({ type: "globe" });
        map.setSky({
          "sky-color": "#060e17",
          "horizon-color": "#214655",
          "fog-color": "#0e2536",
          "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.85, 3, 0.4, 7, 0],
        });
        addMapLayers(map, borders, mapVisits, !localFallbackActive);
        setReady(true);
        setStatus(localFallbackActive
          ? "Globo local ativo. As fronteiras e visitas continuam disponíveis; publique a liberação de rede para ruas e satélite."
          : "Mapa pronto. Zoom contínuo: planeta → países → estados → cidades → ruas.");
      } catch (reason) {
        setStatus(`O mapa abriu, mas uma camada não carregou: ${(reason as Error).message}`);
      }
    });

    map.on("load", () => {
      setReady(true);
      setStatus(localFallbackActive
        ? "Globo local ativo. As fronteiras e visitas continuam disponíveis; publique a liberação de rede para ruas e satélite."
        : "Mapa pronto. Zoom contínuo: planeta → países → estados → cidades → ruas.");
    });
    map.on("zoom", () => setZoom(map.getZoom()));
    for (const eventName of ["mousedown", "touchstart", "wheel", "dragstart"] as const) map.on(eventName, stopSpin);

    map.on("click", "event-points", (event) => {
      const id = String(event.features?.[0]?.properties?.id || "");
      const visit = visitsRef.current.find((entry) => entry.id === id);
      if (visit) focusVisit(map, visit, reducedMotion, setSelected, setAreaTitle, setStatus);
    });
    map.on("click", "clusters", async (event) => {
      const feature = event.features?.[0];
      const source = map.getSource("events") as maplibregl.GeoJSONSource | undefined;
      if (!feature || !source) return;
      const clusterId = Number(feature.properties?.cluster_id);
      const coordinates = (feature.geometry as unknown as { coordinates: [number, number] }).coordinates;
      try {
        const expandedZoom = await source.getClusterExpansionZoom(clusterId);
        map.easeTo({ center: coordinates, zoom: expandedZoom, duration: reducedMotion ? 0 : 650 });
      } catch {
        setStatus("Os eventos estão sendo atualizados. Tente o agrupamento novamente.");
      }
    });
    for (const layer of ["event-points", "clusters"]) {
      map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
    }
    map.on("error", (event) => {
      if (!usableStyleLoaded && !localFallbackActive) {
        localFallbackActive = true;
        setStatus("O mapa externo está indisponível. Ativando o globo local…");
        map.setStyle(localFallbackStyle);
        return;
      }
      if (!map.loaded()) setStatus("Uma camada externa não carregou. Verifique a conexão; os dados do painel continuam disponíveis.");
      if ((event as { sourceId?: string }).sourceId === "elevation") setTerrain(false);
    });

    const resizeObserver = new ResizeObserver(() => requestAnimationFrame(() => map.resize()));
    resizeObserver.observe(containerRef.current);
    return () => {
      cancelAnimationFrame(spinFrame.current);
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [borders]); // Map events read the initial list; the source update below handles later visits.

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource("events") as maplibregl.GeoJSONSource | undefined;
    source?.setData(mapVisits as never);
  }, [mapVisits, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const opacity = styleMode === "satellite"
      ? 1
      : styleMode === "streets"
        ? 0
        : ["interpolate", ["linear"], ["zoom"], 5.5, 1, 8, 0];
    if (map.getLayer("earth-imagery")) map.setPaintProperty("earth-imagery", "raster-opacity", opacity as never);
    setStatus(styleMode === "auto"
      ? "Modo Terra: satélite no globo e ruas ao aproximar."
      : styleMode === "satellite"
        ? "Satélite ativo com nomes e limites sobrepostos."
        : "Mapa de ruas ativo; detalhes aparecem conforme o zoom.");
  }, [ready, styleMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource("selected") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const hasCoordinates = Boolean(selected && selected.latitude !== null && selected.longitude !== null);
    source.setData(hasCoordinates && selected ? {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [selected.longitude, selected.latitude] } }],
    } as never : emptyCollection() as never);
  }, [ready, selected]);

  const flyCountry = (next: "BR" | "US") => {
    const map = mapRef.current;
    if (!map || !ready) return;
    stopSpin();
    setCountry(next);
    setStateId("");
    setRegion("");
    clearArea(map);
    const isBrazil = next === "BR";
    map.flyTo({ center: isBrazil ? [-52, -14] : [-98, 38], zoom: isBrazil ? 3.3 : 3.15, pitch: 0, bearing: 0, duration: 1250 });
    setAreaTitle(isBrazil ? "Brasil" : "Estados Unidos");
  };

  const selectState = (id: string) => {
    setStateId(id);
    setRegion("");
    const feature = borders.features.find((entry) => entry.id === id);
    if (feature && mapRef.current) focusArea(mapRef.current, [feature], String(feature.properties.name), setAreaTitle);
  };

  const selectRegion = (name: string) => {
    setRegion(name);
    setStateId("");
    if (!name || !mapRef.current) return clearArea(mapRef.current!);
    setCountry("BR");
    focusArea(mapRef.current, borders.features.filter((entry) => entry.properties.macro === name), `${name} · Brasil`, setAreaTitle);
  };

  const reset = () => {
    const map = mapRef.current;
    if (!map || !ready) return;
    stopSpin();
    setTilted(false);
    setStateId("");
    setRegion("");
    setAreaTitle("Visão global");
    clearArea(map);
    map.flyTo({ center: [-42, -8], zoom: 0.55, bearing: 0, pitch: 0, duration: 1400 });
  };

  const toggleTerrain = () => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const next = !terrain;
    try {
      if (next && !map.getSource("elevation")) map.addSource("elevation", { type: "raster-dem", url: "https://tiles.mapterhorn.com/tilejson.json" });
      map.setTerrain(next ? { source: "elevation", exaggeration: 1.15 } : null);
      setTerrain(next);
      setStatus(next ? "Relevo 3D ativado. Use Perspectiva e aproxime o mapa." : "Relevo desativado.");
    } catch {
      setTerrain(false);
      setStatus("A camada de relevo está indisponível; o restante do mapa continua ativo.");
    }
  };

  const toggleTilt = () => {
    const map = mapRef.current;
    if (!map || !ready) return;
    stopSpin();
    const next = !tilted;
    setTilted(next);
    map.easeTo({ pitch: next ? 48 : 0, bearing: next ? -12 : 0, duration: 800 });
  };

  const toggleSpin = () => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (spinning) return stopSpin();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || map.getZoom() > 2) {
      setStatus("Volte à visão global para girar o planeta.");
      return;
    }
    setSpinning(true);
    let last = performance.now();
    const step = (time: number) => {
      if (!mapRef.current || mapRef.current.getZoom() > 2) return stopSpin();
      if (time - last > 30) {
        const center = mapRef.current.getCenter();
        mapRef.current.jumpTo({ center: [center.lng + (time - last) * 0.0026, center.lat] });
        last = time;
      }
      spinFrame.current = requestAnimationFrame(step);
    };
    spinFrame.current = requestAnimationFrame(step);
  };

  const submitSearch = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Busca indisponível.");
      setSearchResults(body.results || []);
      setStatus(body.results?.length ? "Escolha o local correto entre os resultados." : "Nenhum local encontrado.");
    } catch (reason) {
      setStatus((reason as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const chooseSearchResult = (result: { displayName: string; latitude: number; longitude: number; type: string }) => {
    const map = mapRef.current;
    if (!map) return;
    setSearchResults([]);
    setAreaTitle(result.displayName.split(",")[0]);
    map.flyTo({
      center: [result.longitude, result.latitude],
      zoom: result.type === "country" ? 3 : result.type === "state" ? 6 : 13,
      duration: 1200,
    });
  };

  const availableStates = borders.features
    .filter((feature) => feature.properties.country === country)
    .sort((a, b) => String(a.properties.name).localeCompare(String(b.properties.name), "pt-BR"));

  return (
    <section className="panel atlas-map-panel">
      <div className="atlas-map-header">
        <div><span className="eyebrow">ORIGEM DO TRÁFEGO</span><h2>Globo de campanhas</h2><p>Arraste para explorar · aproxime até cidades e ruas</p></div>
        <div className="map-style-tabs">
          {(["auto", "satellite", "streets"] as const).map((mode) => (
            <button key={mode} className={styleMode === mode ? "active" : ""} onClick={() => setStyleMode(mode)}>
              {{ auto: "Terra", satellite: "Satélite", streets: "Ruas" }[mode]}
            </button>
          ))}
        </div>
      </div>
      <div className="map-explorer">
        <button className={country === "BR" ? "active" : ""} onClick={() => flyCountry("BR")}>Brasil</button>
        <button className={country === "US" ? "active" : ""} onClick={() => flyCountry("US")}>EUA</button>
        <select value={stateId} onChange={(event) => selectState(event.target.value)}>
          <option value="">{country === "BR" ? "Estados e Distrito Federal" : "Estados e D.C."}</option>
          {availableStates.map((feature) => <option key={feature.id} value={feature.id}>{String(feature.properties.name)}</option>)}
        </select>
        <select value={region} onChange={(event) => selectRegion(event.target.value)}>
          <option value="">Regiões do Brasil</option>
          {Object.keys(brazilRegions).map((name) => <option key={name}>{name}</option>)}
        </select>
        <form className="map-search" onSubmit={submitSearch}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar cidade ou endereço" />
          <button disabled={searching}>{searching ? "…" : "⌕"}</button>
        </form>
      </div>
      <div className="atlas-map-layout">
        <div className="map-canvas-wrap">
          <div ref={containerRef} className="map-canvas" />
          {!ready && <div className="map-loading"><i /><span>{status}</span></div>}
          <div className="map-breadcrumb"><span>{zoomContext(zoom)}</span><b>/</b><strong>{areaTitle}</strong></div>
          <div className="map-zoom-controls">
            <button onClick={() => mapRef.current?.zoomIn()}>+</button>
            <button onClick={() => mapRef.current?.zoomOut()}>−</button>
            <button onClick={reset}>◎</button>
            <span>{zoom.toFixed(1)}×</span>
          </div>
          {!!searchResults.length && <div className="map-search-results">
            <button className="results-close" onClick={() => setSearchResults([])}>Fechar resultados</button>
            {searchResults.map((result) => <button key={`${result.latitude}-${result.longitude}`} onClick={() => chooseSearchResult(result)}>{result.displayName}</button>)}
          </div>}
          <div className="map-toolbar">
            <button className={terrain ? "active" : ""} onClick={toggleTerrain}>⌁ Relevo 3D</button>
            <button className={tilted ? "active" : ""} onClick={toggleTilt}>Perspectiva</button>
            <button className={spinning ? "active" : ""} onClick={toggleSpin}>↻ Girar</button>
          </div>
          <div className="map-status">{status}</div>
        </div>
        <MapInspector selected={selected} visits={visits} onSelect={(visit) => {
          const map = mapRef.current;
          if (map) focusVisit(map, visit, false, setSelected, setAreaTitle, setStatus);
        }} />
      </div>
    </section>
  );
}

function MapInspector({ selected, visits, onSelect }: { selected: Visit | null; visits: Visit[]; onSelect: (visit: Visit) => void }) {
  return (
    <aside className="map-inspector">
      <div className="inspector-head"><span className="eyebrow">INSPEÇÃO DA VISITA</span><span className="live-label"><i /> REAL</span></div>
      <h2>{selected ? selected.city || selected.region || selected.country : "Selecione uma visita"}</h2>
      <p>{selected ? [selected.region, selected.country].filter(Boolean).join(" · ") : "Clique em um ponto ou evento recente."}</p>
      {selected && <>
        <span className={`precision-badge ${selected.locationSource === "browser-consent" ? "device" : ""}`}>
          {selected.locationSource === "browser-consent" ? "LOCALIZAÇÃO AUTORIZADA" : "GEOIP · ESTIMATIVA"}
        </span>
        <dl className="inspector-fields">
          <div><dt>IP público</dt><dd className="mono">{selected.ipMasked}</dd></div>
          <div><dt>Provedor / ISP</dt><dd>{selected.isp || "Não informado"}</dd></div>
          <div><dt>ASN / organização</dt><dd>{[selected.asn ? `AS${selected.asn}` : "", selected.organization].filter(Boolean).join(" · ") || "Não informado"}</dd></div>
          <div><dt>Tipo de rede</dt><dd>{selected.network || "Não informado"}</dd></div>
          <div><dt>Dispositivo</dt><dd>{selected.device}</dd></div>
          <div><dt>User agent</dt><dd>{selected.browser} · {selected.os}</dd></div>
          <div><dt>Fuso horário</dt><dd>{selected.timezone || "Não informado"}</dd></div>
          <div><dt>Campanha</dt><dd>{selected.campaign}</dd></div>
          <div><dt>Origem</dt><dd>{selected.referrer}</dd></div>
        </dl>
        <div className="inspector-coordinates">LAT {selected.latitude ?? "—"} · LON {selected.longitude ?? "—"}</div>
        <div className="accuracy-note">A localização por IP é aproximada. O zoom do mapa não aumenta a precisão da origem.</div>
      </>}
      <div className="inspector-events">
        <div><span className="eyebrow">EVENTOS RECENTES</span><small>{visits.length} no período</small></div>
        {visits.slice(0, 6).map((visit) => (
          <button key={visit.id} className={selected?.id === visit.id ? "selected" : ""} onClick={() => onSelect(visit)}>
            <span><strong>{visit.city || visit.region || visit.country}</strong><small>{visit.ipMasked} · {visit.campaign}</small></span>
            <i>{relativeShort(visit.createdAt)}</i>
          </button>
        ))}
        {!visits.length && <p className="inspector-empty">Aguardando os primeiros acessos consentidos.</p>}
      </div>
    </aside>
  );
}

function addMapLayers(
  map: MapLibreMap,
  borders: { type: "FeatureCollection"; features: GeoFeature[] },
  visits: object,
  externalImagery: boolean,
) {
  if (externalImagery && !map.getSource("earth-imagery")) map.addSource("earth-imagery", {
    type: "raster",
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    tileSize: 256,
    maxzoom: 18,
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics and contributors",
  });
  const firstSymbol = map.getStyle().layers?.find((layer) => layer.type === "symbol")?.id;
  if (externalImagery && !map.getLayer("earth-imagery")) map.addLayer({
    id: "earth-imagery",
    type: "raster",
    source: "earth-imagery",
    paint: { "raster-opacity": ["interpolate", ["linear"], ["zoom"], 5.5, 1, 8, 0], "raster-fade-duration": 250 },
  }, firstSymbol);
  map.addSource("graticule", { type: "geojson", data: graticuleCollection() as never });
  map.addSource("borders", { type: "geojson", data: borders as never, tolerance: 0.5 });
  map.addSource("area", { type: "geojson", data: emptyCollection() as never });
  map.addSource("events", { type: "geojson", data: visits as never, cluster: true, clusterRadius: 42, clusterMaxZoom: 11 });
  map.addSource("selected", { type: "geojson", data: emptyCollection() as never });
  map.addLayer({ id: "graticule-lines", type: "line", source: "graticule", maxzoom: 4.5, paint: { "line-color": "#4e8991", "line-width": 0.55, "line-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.18, 3, 0.08, 4.5, 0] } }, firstSymbol);
  map.addLayer({ id: "state-fills", type: "fill", source: "borders", minzoom: 2, maxzoom: 10, paint: { "fill-color": ["get", "color"], "fill-opacity": ["interpolate", ["linear"], ["zoom"], 2, 0.005, 4, 0.04, 8, 0.02, 10, 0] } }, firstSymbol);
  map.addLayer({ id: "state-borders", type: "line", source: "borders", minzoom: 2.7, paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.65, 7, 1.2, 12, 1.7], "line-opacity": ["interpolate", ["linear"], ["zoom"], 2.7, 0, 3.5, 0.5, 8, 0.7] } }, firstSymbol);
  map.addLayer({ id: "area-fill", type: "fill", source: "area", paint: { "fill-color": "#72e2d5", "fill-opacity": 0.08 } }, firstSymbol);
  map.addLayer({ id: "area-line", type: "line", source: "area", paint: { "line-color": "#7edcce", "line-width": 2, "line-opacity": 0.8 } }, firstSymbol);
  map.addLayer({ id: "clusters", type: "circle", source: "events", filter: ["has", "point_count"], paint: { "circle-color": "#134e52", "circle-radius": ["step", ["get", "point_count"], 15, 10, 19, 100, 25], "circle-stroke-width": 1.5, "circle-stroke-color": "#7ddcc9" } });
  map.addLayer({ id: "cluster-count", type: "symbol", source: "events", filter: ["has", "point_count"], layout: { "text-field": ["to-string", ["get", "point_count_abbreviated"]], "text-size": 11, "text-allow-overlap": true }, paint: { "text-color": "#c2ffef" } });
  map.addLayer({ id: "event-halo", type: "circle", source: "events", filter: ["!", ["has", "point_count"]], paint: { "circle-radius": 11, "circle-color": "#64e0c8", "circle-opacity": 0.15 } });
  map.addLayer({ id: "event-points", type: "circle", source: "events", filter: ["!", ["has", "point_count"]], paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 3, 8, 5, 14, 6], "circle-color": "#5fe0c6", "circle-stroke-width": 1.2, "circle-stroke-color": "#e1fff5" } });
  map.addLayer({ id: "selected-halo", type: "circle", source: "selected", paint: { "circle-radius": 14, "circle-color": "#9af7db", "circle-opacity": 0.16 } });
  map.addLayer({ id: "selected-point", type: "circle", source: "selected", paint: { "circle-radius": 7, "circle-color": "#80ebc9", "circle-stroke-color": "#f0fff9", "circle-stroke-width": 2 } });
}

function graticuleCollection() {
  const features: Array<{ type: "Feature"; properties: Record<string, never>; geometry: { type: "LineString"; coordinates: number[][] } }> = [];
  for (let longitude = -150; longitude <= 180; longitude += 30) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: Array.from({ length: 35 }, (_, index) => [longitude, -85 + index * 5]) },
    });
  }
  for (let latitude = -60; latitude <= 60; latitude += 30) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: Array.from({ length: 73 }, (_, index) => [-180 + index * 5, latitude]) },
    });
  }
  return { type: "FeatureCollection" as const, features };
}

function focusVisit(
  map: MapLibreMap,
  visit: Visit,
  reducedMotion: boolean,
  setSelected: (visit: Visit) => void,
  setAreaTitle: (title: string) => void,
  setStatus: (status: string) => void,
) {
  setSelected(visit);
  setAreaTitle(visit.city || visit.region || visit.country || "Visita selecionada");
  if (visit.latitude === null || visit.longitude === null) {
    setStatus("A fonte não retornou coordenadas. Os demais dados continuam no painel.");
    return;
  }
  map.flyTo({ center: [visit.longitude, visit.latitude], zoom: visit.locationSource === "browser-consent" ? 12 : 8.5, duration: reducedMotion ? 0 : 1300, pitch: 0, bearing: 0 });
  setStatus(visit.locationSource === "browser-consent" ? "Localização autorizada pelo visitante." : "Localização aproximada pela base GeoIP.");
}

function focusArea(map: MapLibreMap, features: GeoFeature[], name: string, setAreaTitle: (title: string) => void) {
  if (!features.length) return;
  const data = { type: "FeatureCollection", features };
  const source = map.getSource("area") as maplibregl.GeoJSONSource | undefined;
  source?.setData(data as never);
  const bounds = geometryBounds(features);
  map.fitBounds(bounds, { padding: 50, maxZoom: 9, duration: 1050, pitch: 0 });
  setAreaTitle(name);
}

function geometryBounds(features: GeoFeature[]) {
  const bounds = new LngLatBounds();
  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number" && typeof value[1] === "number") bounds.extend([value[0], value[1]]);
    else value.forEach(visit);
  };
  features.forEach((feature) => visit(feature.geometry.coordinates));
  return bounds;
}

function clearArea(map: MapLibreMap) {
  const source = map.getSource("area") as maplibregl.GeoJSONSource | undefined;
  source?.setData(emptyCollection() as never);
}

function emptyCollection() {
  return { type: "FeatureCollection" as const, features: [] };
}

function zoomContext(zoom: number) {
  if (zoom < 2.5) return "PLANETA";
  if (zoom < 4) return "PAÍSES";
  if (zoom < 7) return "ESTADOS";
  if (zoom < 11) return "CIDADES";
  if (zoom < 14) return "BAIRROS";
  return "RUAS";
}

function relativeShort(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "agora";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}
