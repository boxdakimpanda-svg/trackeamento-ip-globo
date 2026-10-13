import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import TrackingPage from "./TrackingPage";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

const isTrackingPage = window.location.pathname.startsWith("/t/");

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isTrackingPage ? <TrackingPage /> : <App />}</StrictMode>,
);
