// Расстояние по дорогам. Если задан OSRM_URL (сервер маршрутизации OSRM), считаем по реальным дорогам и запоминаем ответ;
// иначе — оценка: сумма прямых отрезков с дорожным коэффициентом.
import { q1, run } from './db.js';
import { roadKm } from './geo.js';

const OSRM = (process.env.OSRM_URL || '').replace(/\/$/, '');

/** points: [{id, lat, lon}] → { km, geometry: [[lat, lon]…] | null, source: 'roads' | 'estimate' } */
export async function route(points) {
  const estimate = { km: roadKm(points), geometry: null, source: 'estimate' };
  if (!OSRM || points.length < 2) return estimate;
  const key = points.map((p) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`).join(';');
  const hit = q1('SELECT km, geometry FROM route_cache WHERE key = ?', key);
  if (hit) return { km: hit.km, geometry: JSON.parse(hit.geometry), source: 'roads' };
  try {
    const coords = points.map((p) => `${p.lon},${p.lat}`).join(';');
    const res = await fetch(`${OSRM}/route/v1/driving/${coords}?overview=simplified&geometries=geojson`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    const r = data?.routes?.[0];
    if (data.code !== 'Ok' || !r) return estimate;
    const geometry = r.geometry.coordinates.map(([lon, lat]) => [Number(lat.toFixed(4)), Number(lon.toFixed(4))]);
    const km = Math.round(r.distance / 1000);
    run('INSERT OR REPLACE INTO route_cache(key, km, geometry) VALUES(?, ?, ?)', key, km, JSON.stringify(geometry));
    return { km, geometry, source: 'roads' };
  } catch {
    return estimate; // сервер маршрутов недоступен — работаем по оценке
  }
}
