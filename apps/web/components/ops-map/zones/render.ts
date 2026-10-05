import type * as Leaflet from 'leaflet';
import type { LiveMapZone } from '@criticom/api';
import { fromGeometry, zoneKind, type LatLng } from '@/lib/ops-map/zones';
import { escapeHtml } from '@/lib/utils';

type L = typeof Leaflet;

/**
 * Saved perimeters and zones on the live map, coloured by type and named, so
 * a wall display reads without anyone touching it. A private draft has a
 * dashed outline. Clicking one opens its card — unless a drawing is under
 * way, when the click belongs to the drawing.
 */
export function drawZones(
  L: L,
  group: Leaflet.LayerGroup,
  zones: readonly LiveMapZone[],
  opts: {
    selectedId: string | null;
    /** The zone being edited is drawn by the editor instead. */
    hiddenId: string | null;
    isDrawing: () => boolean;
    onSelect: (id: string) => void;
    /** A click on a point zone while drawing: put the drawing's point exactly there. */
    onSnap: (p: LatLng) => void;
    renderer?: Leaflet.Renderer;
  },
) {
  group.clearLayers();
  for (const z of zones) {
    if (z.id === opts.hiddenId) continue;
    const points = fromGeometry(z.shape, z.geometry);
    if (!points.length) continue;
    const kind = zoneKind(z.kind);
    const selected = z.id === opts.selectedId;
    const draft = z.visibility === 'private';
    const style: Leaflet.PathOptions = {
      color: kind.colour,
      weight: selected ? 4.5 : 2.5,
      opacity: 0.95,
      fillColor: kind.colour,
      fillOpacity: selected ? 0.3 : 0.16,
      dashArray: draft ? '7 6' : undefined,
      renderer: opts.renderer,
    };

    let layer: Leaflet.Layer;
    if (z.shape === 'polygon') {
      layer = L.polygon(points, style);
    } else if (z.shape === 'circle') {
      layer = L.circle(points[0]!, { ...style, radius: z.radius_m ?? 1 });
    } else if (z.shape === 'line') {
      layer = L.polyline(points, {
        ...style,
        weight: selected ? 8 : 5.5,
        dashArray: draft ? '7 6' : z.kind === 'road_closure' ? '12 7' : undefined,
      });
    } else {
      layer = L.marker(points[0]!, {
        keyboard: false,
        zIndexOffset: 500,
        icon: L.divIcon({
          className: 'zone-point-wrap',
          html: `<span class="zone-point" data-selected="${selected}" data-draft="${draft}" style="--zone:${kind.colour}">${escapeHtml(kind.mark)}</span>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
      });
    }

    layer.bindTooltip(`<span style="--zone:${kind.colour}">${escapeHtml(z.name)}</span>`, {
      permanent: true,
      direction: z.shape === 'point' ? 'right' : 'center',
      offset: z.shape === 'point' ? [14, 0] : [0, 0],
      className: 'zone-label',
      interactive: false,
    });

    layer.on('click', () => {
      if (opts.isDrawing()) {
        // Areas and lines pass the click on to the map, which places the point;
        // a point zone does not, so place it on the zone's exact position.
        if (z.shape === 'point') opts.onSnap(points[0]!);
        return;
      }
      opts.onSelect(z.id);
    });
    group.addLayer(layer);
  }
}

/** Fit the map to one zone. */
export function zoneBounds(L: L, z: LiveMapZone): Leaflet.LatLngBounds | null {
  const points = fromGeometry(z.shape, z.geometry);
  if (!points.length) return null;
  // A circle's own getBounds() needs it to be on a map; work it out from the centre.
  if (z.shape === 'circle') return L.latLng(points[0]!).toBounds((z.radius_m ?? 1) * 2);
  if (z.shape === 'point') return L.latLngBounds([points[0]!, points[0]!]);
  return L.latLngBounds(points);
}
