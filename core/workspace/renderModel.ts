// Render Model (Phase 4, Step 3) — the only shape data may take once it
// crosses from Presenter into a Board. Deliberately generic: a Board never
// knows whether a widget's value came from a real query or a static
// config — it just renders what it's given. No business fields (no
// "invoiceTotal", no "partnerName") live here; those exist only inside
// whatever produced the RenderModel (a Presenter), never in this type.

export interface WidgetModel {
  id: string;
  label: string;
  value: string | number;
  trend?: "up" | "down" | "flat";
}

export interface TableModel {
  id: string;
  title?: string;
  columns: string[];
  rows: (string | number)[][];
}

export interface CardModel {
  id: string;
  title: string;
  body: string;
  footer?: string;
}

export interface ChartModel {
  id: string;
  title?: string;
  kind: "line" | "bar" | "pie";
  series: { label: string; points: number[] }[];
}

export interface PanelModel {
  id: string;
  title: string;
  content: string; // opaque — a Presenter decides what this means, RenderModel doesn't
}

export interface ActionModel {
  id: string;
  label: string;
  intent?: "default" | "primary" | "danger";
}

export interface RenderModel {
  title: string;
  subtitle?: string;
  widgets: WidgetModel[];
  tables: TableModel[];
  cards: CardModel[];
  charts: ChartModel[];
  panels: PanelModel[];
  actions: ActionModel[];
}

export const EMPTY_RENDER_MODEL: RenderModel = {
  title: "",
  widgets: [],
  tables: [],
  cards: [],
  charts: [],
  panels: [],
  actions: [],
};