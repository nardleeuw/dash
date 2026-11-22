"use client";
import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";

export type MapPoint = { id: string; lat: number; lng: number; label: string; sublabel?: string; selected?: boolean };

function FitBounds({ points }: { points: MapPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    const bounds: LatLngBoundsExpression = [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ];
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }, [map, points]);
  return null;
}

export default function ResultsMap({ points, onToggle }: { points: MapPoint[]; onToggle?: (id: string) => void }) {
  return (
    <MapContainer center={[52.13, 5.29]} zoom={7} scrollWheelZoom className="h-[560px] w-full">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bijdragers'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {points.map((p) => (
        <CircleMarker
          key={p.id}
          center={[p.lat, p.lng]}
          radius={p.selected ? 8 : 6}
          pathOptions={{ color: p.selected ? "#1d4ed8" : "#2563eb", weight: 2, fillColor: p.selected ? "#2563eb" : "#ffffff", fillOpacity: 0.9 }}
          eventHandlers={{ click: () => onToggle?.(p.id) }}
        >
          <Tooltip direction="top" offset={[0, -6]}>
            <span className="font-medium">{p.label}</span>
            {p.sublabel ? <><br /><span className="text-xs opacity-70">{p.sublabel}</span></> : null}
          </Tooltip>
        </CircleMarker>
      ))}
      <FitBounds points={points} />
    </MapContainer>
  );
}
