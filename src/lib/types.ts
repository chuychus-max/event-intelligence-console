// Tipos compartidos entre el motor (servidor) y la consola (navegador).

export type Area = "OPS" | "SEG" | "AYB" | "COM" | "PC" | "FAN";
export type Status = "good" | "warning" | "serious" | "critical";
export type Source = "sim" | "live";

export const AREA_LABEL: Record<Area, string> = {
  OPS: "Operaciones",
  SEG: "Seguridad",
  AYB: "Alimentos y bebidas",
  COM: "Comercial",
  PC: "Protección Civil",
  FAN: "Fan",
};

export const STATUS_LABEL: Record<Status, string> = {
  good: "Fluido",
  warning: "Atención",
  serious: "Saturado",
  critical: "Crítico",
};

export interface GateConfig {
  id: string; // A–H (coinciden con la maqueta 3D)
  name: string;
  share: number; // fracción de boletos asignados a la puerta
  lanes: number; // carriles abiertos al inicio
  lanesMax: number; // carriles que se pueden abrir como máximo
}

export interface BarConfig {
  id: string; // 1–6
  name: string;
  registers: number; // cajas abiertas al inicio
}

export interface EventConfig {
  name: string;
  venue: string;
  date: string; // AAAA-MM-DD, fecha local del recinto
  timezone: string; // IANA, p. ej. America/Mexico_City
  doorsOpen: string; // HH:MM
  showStart: string; // HH:MM
  capacity: number;
  ticketsSold: number;
  scanRatePerLane: number; // personas por carril por minuto
  gates: GateConfig[];
  bars: BarConfig[];
  thresholds: { warning: number; serious: number; critical: number }; // minutos de espera
  barQueueAlert: number; // minutos de fila en barra
  densityAlert: number; // personas/m² en pista
  autopilot: boolean;
  source: Source;
  sim: { speed: number; startedAt: number | null; offset: number; seed: number };
}

export interface FeedEvent {
  id: string;
  minute: number;
  area: Area;
  kind: "alerta" | "accion" | "aviso" | "dato" | "resuelto";
  text: string;
  severity?: Status;
  at?: string; // ancla en el mapa: gate:C, bar:4, spot:1, pista
  actionId?: string;
}

export type ActionStatus = "pending" | "approved" | "auto" | "dismissed";

export interface Action {
  id: string;
  minute: number;
  area: Area;
  text: string;
  why: string;
  at?: string;
  status: ActionStatus;
  decidedMinute?: number;
}

export interface Decision {
  decision: "approve" | "dismiss";
  minute: number;
  at: number; // epoch ms
}

export interface GateView {
  id: string;
  name: string;
  lanes: number;
  lanesMax: number;
  served: number; // escaneos en el minuto
  arrivals: number; // llegadas estimadas en el minuto
  queue: number;
  wait: number;
  status: Status;
  forecastWait: number; // espera máxima en los próximos 30 min
  forecastStatus: Status;
  queueSource: "sensor" | "estimado" | "sin datos";
}

export interface BarView {
  id: string;
  name: string;
  registers: number;
  queueMin: number | null;
  salesTotal: number;
  tx: number;
  salesPerMin: number;
}

export interface ConsoleState {
  generatedAt: number;
  source: Source;
  running: boolean;
  speed: number;
  minute: number; // minutos desde la apertura de puertas
  totalMinutes: number; // apertura → inicio del show + 30
  showMinute: number;
  phase: "antes" | "ingreso" | "show" | "cierre";
  clock: string;
  event: { name: string; venue: string; date: string; doorsOpen: string; showStart: string; capacity: number; ticketsSold: number };
  autopilot: boolean;
  kpis: {
    inside: number;
    scansPerMin: number;
    inQueue: number;
    openAlerts: number;
    actionsExecuted: number;
    actionsPending: number;
    salesTotal: number;
    salesPerMin: number;
    density: number | null;
    densityStatus: Status;
  };
  gates: GateView[];
  bars: BarView[];
  series: { scans: number[]; expected: number[]; inside: number[] };
  feed: FeedEvent[];
  actions: Action[];
  storage: "memoria" | "redis";
  ingestEnabled: boolean;
  copilotAI: boolean;
}
