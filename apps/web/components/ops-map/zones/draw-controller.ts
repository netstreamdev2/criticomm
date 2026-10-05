import type * as Leaflet from 'leaflet';
import type { MapZoneShape } from '@criticom/db';
import { dedupePoints, distanceM, type LatLng } from '@/lib/ops-map/zones';

/**
 * Drawing one perimeter or zone on the live map, precisely.
 *
 * Placing: click to put down points (or a circle's centre, then its edge),
 * with a guide line to the pointer and live measurements. Double-click,
 * Enter, or clicking the first point closes an area; Backspace takes the
 * last point back; Esc cancels. Clicking a call's pin puts the point exactly
 * on the call (OpsMap forwards those clicks to place()).
 *
 * Editing: every point is a handle to drag; the small dots between points
 * add a point; right-click or double-click a point to remove it. A circle has
 * a centre handle and an edge handle; its radius and centre can also be typed
 * in the form, to the metre and to six decimal places.
 */

type L = typeof Leaflet;

export type DrawPhase = 'placing' | 'editing';

export type DrawSnapshot = {
  shape: MapZoneShape;
  phase: DrawPhase;
  points: LatLng[];
  /** A circle's radius in metres — while placing, the distance to the pointer. */
  radiusM: number | null;
  /** While placing an area or line, where the next point would go. */
  cursor: LatLng | null;
};

const MIN_POINTS: Record<MapZoneShape, number> = { polygon: 3, line: 2, circle: 1, point: 1 };
/** How close (in screen pixels) a click must be to the first point to close an area. */
const CLOSE_PX = 12;
const R = 6378137;

const plain = (p: Leaflet.LatLng): LatLng => ({ lat: p.lat, lng: p.lng });

/** The point `metres` due east of `p` — where a circle's edge handle sits. */
function eastOf(p: LatLng, metres: number): LatLng {
  const dLng = (metres / (R * Math.cos((p.lat * Math.PI) / 180))) * (180 / Math.PI);
  return { lat: p.lat, lng: p.lng + dLng };
}

export class ZoneDrawController {
  private readonly L: L;
  private readonly map: Leaflet.Map;
  private readonly emit: (s: DrawSnapshot) => void;
  private readonly onCancel: () => void;
  private colour: string;
  private state: DrawSnapshot;

  private path: Leaflet.Polygon | Leaflet.Polyline | null = null;
  private circle: Leaflet.Circle | null = null;
  private guide: Leaflet.Polyline | null = null;
  private readonly handles: Leaflet.LayerGroup;
  private mids: Leaflet.Marker[] = [];
  private dragIndex = -1;
  private frame = 0;

  constructor(opts: {
    L: L;
    map: Leaflet.Map;
    shape: MapZoneShape;
    colour: string;
    emit: (s: DrawSnapshot) => void;
    onCancel: () => void;
    /** Open an existing shape straight into editing. */
    existing?: { points: LatLng[]; radiusM: number | null };
  }) {
    this.L = opts.L;
    this.map = opts.map;
    this.emit = opts.emit;
    this.onCancel = opts.onCancel;
    this.colour = opts.colour;
    this.handles = this.L.layerGroup().addTo(this.map);
    this.state = { shape: opts.shape, phase: 'placing', points: [], radiusM: null, cursor: null };

    this.map.on('click', this.onClick);
    this.map.on('mousemove', this.onMove);
    this.map.on('dblclick', this.onDblClick);
    document.addEventListener('keydown', this.onKey);

    if (opts.existing && opts.existing.points.length >= MIN_POINTS[opts.shape]) {
      this.state = { ...this.state, points: [...opts.existing.points], radiusM: opts.existing.radiusM };
      this.enterEditing();
    } else {
      this.map.doubleClickZoom.disable();
      this.map.getContainer().classList.add('zone-drawing');
      this.redraw();
      this.schedule();
    }
  }

  get snapshot(): DrawSnapshot {
    return { ...this.state, points: [...this.state.points] };
  }

  get placing() {
    return this.state.phase === 'placing';
  }

  /* ── Placing ─────────────────────────────────────────────────────── */

  /** Put down the next point here (a map click, or a snap to a call's pin). */
  place(p: LatLng) {
    if (this.state.phase !== 'placing') return;
    const s = this.state;
    if (s.shape === 'point') {
      s.points = [p];
      this.finish();
      return;
    }
    if (s.shape === 'circle') {
      if (!s.points.length) {
        s.points = [p];
        s.radiusM = null;
      } else {
        s.radiusM = Math.max(1, Math.round(distanceM(s.points[0]!, p)));
        this.finish();
        return;
      }
    } else {
      s.points = [...s.points, p];
    }
    this.redraw();
    this.schedule();
  }

  /** Take back the last point (or a circle's centre). */
  undo() {
    if (this.state.phase !== 'placing') return;
    if (this.state.shape === 'circle') {
      this.state.points = [];
      this.state.radiusM = null;
    } else {
      this.state.points = this.state.points.slice(0, -1);
    }
    this.redraw();
    this.schedule();
  }

  /** Close the shape and open it for editing. False if it has too few points yet. */
  finish(): boolean {
    if (this.state.phase !== 'placing') return true;
    const s = this.state;
    if (s.shape === 'polygon' || s.shape === 'line') s.points = dedupePoints(s.points);
    if (s.points.length < MIN_POINTS[s.shape] || (s.shape === 'circle' && !s.radiusM)) {
      this.redraw();
      this.schedule();
      return false;
    }
    this.enterEditing();
    return true;
  }

  private readonly onClick = (e: Leaflet.LeafletMouseEvent) => {
    if (this.state.phase !== 'placing') return;
    const s = this.state;
    // Clicking the first point closes an area.
    if (s.shape === 'polygon' && s.points.length >= 3) {
      const first = this.map.latLngToContainerPoint(s.points[0]!);
      if (first.distanceTo(e.containerPoint) <= CLOSE_PX) {
        this.finish();
        return;
      }
    }
    this.place(plain(e.latlng));
  };

  private readonly onMove = (e: Leaflet.LeafletMouseEvent) => {
    if (this.state.phase !== 'placing') return;
    const s = this.state;
    s.cursor = plain(e.latlng);
    if (s.shape === 'circle' && s.points.length) s.radiusM = Math.max(1, Math.round(distanceM(s.points[0]!, s.cursor)));
    this.redraw();
    this.schedule();
  };

  private readonly onDblClick = () => {
    if (this.state.phase === 'placing') this.finish();
  };

  private readonly onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.onCancel();
    } else if (this.state.phase === 'placing' && e.key === 'Enter') {
      e.preventDefault();
      this.finish();
    } else if (this.state.phase === 'placing' && (e.key === 'Backspace' || e.key === 'Delete')) {
      e.preventDefault();
      this.undo();
    }
  };

  /* ── Editing (and the form's exact values) ───────────────────────── */

  /** Move a circle's centre or a point to an exact position. */
  setPosition(p: LatLng) {
    if (this.state.shape !== 'circle' && this.state.shape !== 'point') return;
    this.state.points = [p];
    this.afterEdit();
  }

  /** Set a circle's radius to the metre. */
  setRadius(metres: number) {
    if (this.state.shape !== 'circle' || !Number.isFinite(metres) || metres < 1) return;
    this.state.radiusM = metres;
    this.afterEdit();
  }

  setColour(colour: string) {
    this.colour = colour;
    this.path?.setStyle({ color: colour, fillColor: colour });
    this.circle?.setStyle({ color: colour, fillColor: colour });
    this.guide?.setStyle({ color: colour });
  }

  /** Remove everything this drawing put on the map. */
  destroy() {
    this.map.off('click', this.onClick);
    this.map.off('mousemove', this.onMove);
    this.map.off('dblclick', this.onDblClick);
    document.removeEventListener('keydown', this.onKey);
    if (this.frame) cancelAnimationFrame(this.frame);
    this.path?.remove();
    this.circle?.remove();
    this.guide?.remove();
    this.handles.remove();
    this.map.doubleClickZoom.enable();
    this.map.getContainer().classList.remove('zone-drawing');
  }

  private enterEditing() {
    this.state.phase = 'editing';
    this.state.cursor = null;
    this.map.doubleClickZoom.enable();
    this.map.getContainer().classList.remove('zone-drawing');
    this.redraw();
    this.buildHandles();
    this.schedule();
  }

  private afterEdit() {
    this.redraw();
    if (this.state.phase === 'editing') this.buildHandles();
    this.schedule();
  }

  /** One update per animation frame, however fast the pointer moves. */
  private schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.emit(this.snapshot);
    });
  }

  /* ── Drawing the shape ───────────────────────────────────────────── */

  private redraw() {
    const { L, map } = this;
    const s = this.state;
    const placing = s.phase === 'placing';
    const style = {
      color: this.colour, weight: 3, opacity: 1, fillColor: this.colour, fillOpacity: 0.18,
      dashArray: placing ? '6 6' : undefined, interactive: false,
    };

    if (s.shape === 'circle') {
      const centre = s.points[0];
      if (centre && s.radiusM) {
        if (!this.circle) this.circle = L.circle(centre, { ...style, radius: s.radiusM }).addTo(map);
        this.circle.setLatLng(centre).setRadius(s.radiusM).setStyle({ dashArray: style.dashArray });
      } else {
        this.circle?.remove();
        this.circle = null;
      }
    } else if (s.shape === 'polygon' || s.shape === 'line') {
      const closed = s.shape === 'polygon' && (!placing || s.points.length >= 3);
      if (this.path && (this.path instanceof L.Polygon) !== closed) {
        this.path.remove();
        this.path = null;
      }
      if (s.points.length) {
        if (!this.path) this.path = (closed ? L.polygon(s.points, style) : L.polyline(s.points, style)).addTo(map);
        this.path.setLatLngs(s.points).setStyle({ dashArray: style.dashArray });
      } else {
        this.path?.remove();
        this.path = null;
      }
    }

    // While placing: a guide from the last point to the pointer (and back to the first, for an area).
    const last = s.points[s.points.length - 1];
    const guidePoints: LatLng[] = [];
    if (placing && s.cursor && last && (s.shape === 'polygon' || s.shape === 'line')) {
      guidePoints.push(last, s.cursor);
      if (s.shape === 'polygon' && s.points.length >= 2) guidePoints.push(s.points[0]!);
    }
    if (guidePoints.length) {
      if (!this.guide) {
        this.guide = L.polyline(guidePoints, { color: this.colour, weight: 2, opacity: 0.9, dashArray: '4 6', interactive: false }).addTo(map);
      }
      this.guide.setLatLngs(guidePoints);
    } else {
      this.guide?.remove();
      this.guide = null;
    }

    if (placing) this.drawPlacingDots();
  }

  /** While placing, plain dots mark the points so far; the first is larger (click it to close). */
  private drawPlacingDots() {
    const { L } = this;
    this.handles.clearLayers();
    this.state.points.forEach((p, i) => {
      L.circleMarker(p, {
        radius: i === 0 && this.state.shape === 'polygon' ? 7 : 4.5,
        color: '#ffffff', weight: 2, fillColor: this.colour, fillOpacity: 1, interactive: false,
      }).addTo(this.handles);
    });
  }

  private handle(p: LatLng, kind: 'vertex' | 'mid' | 'centre' | 'edge', title: string) {
    const size = kind === 'mid' ? 12 : 16;
    return this.L.marker(p, {
      draggable: true,
      keyboard: false,
      title,
      zIndexOffset: kind === 'mid' ? 2900 : 3000,
      icon: this.L.divIcon({
        className: `zone-handle zone-handle--${kind}`,
        html: `<span style="--zone:${this.colour}"></span>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      }),
    });
  }

  private buildHandles() {
    this.handles.clearLayers();
    this.mids = [];
    const s = this.state;

    if (s.shape === 'circle') {
      const centre = s.points[0]!;
      const radius = s.radiusM ?? 1;
      const c = this.handle(centre, 'centre', 'Drag to move the circle');
      const edge = this.handle(eastOf(centre, radius), 'edge', 'Drag to change the radius');
      c.on('drag', () => {
        s.points = [plain(c.getLatLng())];
        edge.setLatLng(eastOf(s.points[0]!, s.radiusM ?? radius));
        this.redraw();
        this.schedule();
      });
      edge.on('drag', () => {
        s.radiusM = Math.max(1, Math.round(distanceM(s.points[0]!, plain(edge.getLatLng()))));
        this.redraw();
        this.schedule();
      });
      edge.on('dragend', () => edge.setLatLng(eastOf(s.points[0]!, s.radiusM ?? radius)));
      this.handles.addLayer(c).addLayer(edge);
      return;
    }

    if (s.shape === 'point') {
      const h = this.handle(s.points[0]!, 'centre', 'Drag to move the point');
      h.on('drag', () => {
        s.points = [plain(h.getLatLng())];
        this.schedule();
      });
      this.handles.addLayer(h);
      return;
    }

    const closed = s.shape === 'polygon';
    const min = MIN_POINTS[s.shape];
    s.points.forEach((p, i) => {
      const h = this.handle(p, 'vertex', 'Drag to move · right-click or double-click to remove');
      h.on('drag', () => {
        s.points[i] = plain(h.getLatLng());
        this.redraw();
        this.placeMids();
        this.schedule();
      });
      const remove = (ev: Leaflet.LeafletEvent) => {
        const original = (ev as Leaflet.LeafletMouseEvent).originalEvent;
        if (original) this.L.DomEvent.stop(original);
        if (s.points.length <= min) return;
        s.points = s.points.filter((_, j) => j !== i);
        this.afterEdit();
      };
      h.on('contextmenu', remove);
      h.on('dblclick', remove);
      this.handles.addLayer(h);
    });

    const segments = closed ? s.points.length : s.points.length - 1;
    for (let i = 0; i < segments; i++) {
      const m = this.handle(s.points[i]!, 'mid', 'Drag (or click) to add a point here');
      m.on('dragstart', () => {
        this.dragIndex = i + 1;
        s.points.splice(this.dragIndex, 0, plain(m.getLatLng()));
      });
      m.on('drag', () => {
        if (this.dragIndex < 0) return;
        s.points[this.dragIndex] = plain(m.getLatLng());
        this.redraw();
        this.schedule();
      });
      m.on('dragend', () => {
        this.dragIndex = -1;
        this.afterEdit();
      });
      m.on('click', () => {
        s.points.splice(i + 1, 0, plain(m.getLatLng()));
        this.afterEdit();
      });
      this.mids.push(m);
      this.handles.addLayer(m);
    }
    this.placeMids();
  }

  /** Keep the add-a-point dots halfway along each edge as points move. */
  private placeMids() {
    const pts = this.state.points;
    this.mids.forEach((m, i) => {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (a && b) m.setLatLng({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });
    });
  }
}
