import type { TimeSeriesMetric } from '../schema/ui-schema.js';

export interface TimeSeriesPoint {
  ts: string;
  value: number;
}

export interface TimeSeriesDescriptor {
  metric: TimeSeriesMetric;
  label: string;
  unit: string;
  min: number;
  max: number;
  points: TimeSeriesPoint[];
}

const METRIC_META: Record<TimeSeriesMetric, { label: string; unit: string; min: number; max: number; seed: number[] }> = {
  audio_rms_dbfs: {
    label: 'Audio RMS Level',
    unit: 'dBFS',
    min: -60,
    max: 0,
    seed: [-22, -19, -18, -16, -20, -17, -15, -18, -21, -16, -14, -17],
  },
  caption_lag_ms: {
    label: 'Caption / Subtitle Lag',
    unit: 'ms',
    min: 0,
    max: 5000,
    seed: [850, 920, 1100, 980, 1050, 1200, 1150, 950, 890, 1020, 970, 910],
  },
  shot_dwell_sec: {
    label: 'Program Shot Dwell',
    unit: 's',
    min: 0,
    max: 120,
    seed: [12, 18, 25, 32, 14, 22, 41, 28, 19, 35, 24, 16],
  },
  stream_bitrate_kbps: {
    label: 'Stream Outbound Bitrate',
    unit: 'kbps',
    min: 0,
    max: 10000,
    seed: [6100, 6250, 6180, 6200, 6150, 6220, 6190, 6210, 6240, 6170, 6200, 6230],
  },
  camera_motion_speed: {
    label: 'PTZ Camera Motion Speed',
    unit: 'deg/s',
    min: 0,
    max: 30,
    seed: [0, 2.5, 4.0, 0, 0, 1.8, 0, 3.2, 0, 0, 1.2, 0],
  },
};

export class TimeSeriesStore {
  private readonly maxPoints: number;
  private readonly series = new Map<TimeSeriesMetric, TimeSeriesPoint[]>();

  constructor(maxPoints = 60) {
    this.maxPoints = maxPoints;
    const now = Date.now();
    for (const [metric, meta] of Object.entries(METRIC_META) as [TimeSeriesMetric, typeof METRIC_META[TimeSeriesMetric]][]) {
      const pts: TimeSeriesPoint[] = meta.seed.map((value, idx) => ({
        ts: new Date(now - (meta.seed.length - idx) * 5000).toISOString(),
        value,
      }));
      this.series.set(metric, pts);
    }
  }

  record(metric: TimeSeriesMetric, value: number, ts = new Date().toISOString()): TimeSeriesPoint {
    const list = this.series.get(metric) ?? [];
    const point: TimeSeriesPoint = { ts, value: Number(value.toFixed(2)) };
    list.push(point);
    while (list.length > this.maxPoints) {
      list.shift();
    }
    this.series.set(metric, list);
    return point;
  }

  getSeries(metric: TimeSeriesMetric, windowSec?: number): TimeSeriesDescriptor {
    const meta = METRIC_META[metric] ?? METRIC_META.audio_rms_dbfs;
    const allPoints = this.series.get(metric) ?? [];
    let points = [...allPoints];
    if (windowSec && windowSec > 0 && points.length > 0) {
      const latestMs = Date.parse(points[points.length - 1]!.ts);
      const cutoff = latestMs - windowSec * 1000;
      const filtered = points.filter((p) => Date.parse(p.ts) >= cutoff);
      if (filtered.length >= 2) {
        points = filtered;
      }
    }
    return {
      metric,
      label: meta.label,
      unit: meta.unit,
      min: meta.min,
      max: meta.max,
      points,
    };
  }

  listAll(): TimeSeriesDescriptor[] {
    return (Object.keys(METRIC_META) as TimeSeriesMetric[]).map((m) => this.getSeries(m));
  }
}
