"use client";

import { CSSProperties, PointerEvent, useEffect, useMemo, useRef, useState } from "react";

type LayoutType = "horseshoe" | "rows" | "groups";
type TableType = "double" | "single";

type Seat = {
  id: number;
  tableId: string;
  slot: number;
  assigned: number | null;
};

type Table = {
  id: string;
  type: TableType;
  x: number;
  y: number;
  rotation: number;
};

type SeatingState = {
  layoutType: LayoutType;
  classSize: number;
  tables: Table[];
  seats: Seat[];
  nextTableNumber: number;
  nextSeatNumber: number;
};

type DragState = { tableId: string; dx: number; dy: number } | null;

const STORAGE_KEY = "sitzordnung-randomizer-v1";
const STAGE_W = 1000;
const STAGE_H = 680;

const layoutLabels: Record<LayoutType, string> = {
  horseshoe: "Hufeisen / U-Form",
  rows: "Reihen mit Mittelgang",
  groups: "Gruppentische",
};

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function makeSeats(tables: Table[], previous?: Seat[]) {
  const oldAssignments = new Map((previous ?? []).map((seat) => [`${seat.tableId}:${seat.slot}`, seat.assigned]));
  let id = 1;
  return tables.flatMap((table) => {
    const count = table.type === "double" ? 2 : 1;
    return Array.from({ length: count }, (_, slot) => ({
      id: id++,
      tableId: table.id,
      slot,
      assigned: oldAssignments.get(`${table.id}:${slot}`) ?? null,
    }));
  });
}

function createLayout(layoutType: LayoutType, classSize: number, tableType: TableType = "double", randomizeAssignments = true): SeatingState {
  const tables: Table[] = [];
  let tableNumber = 1;

  const add = (x: number, y: number, type = tableType, rotation = 0) => {
    tables.push({ id: `T${tableNumber}`, type, x, y, rotation });
    tableNumber += 1;
  };

  if (layoutType === "horseshoe") {
    const tableCount = Math.max(10, Math.ceil(classSize / 2));
    const topCount = Math.ceil(tableCount / 2);
    const sideCount = Math.floor((tableCount - topCount) / 2);
    for (let i = 0; i < topCount; i += 1) {
      const x = 0.16 + (i * 0.68) / Math.max(1, topCount - 1);
      add(x, 0.18, tableType, 0);
    }
    for (let i = 0; i < sideCount; i += 1) {
      add(0.12, 0.38 + (i * 0.34) / Math.max(1, sideCount - 1), tableType, 90);
      add(0.88, 0.38 + (i * 0.34) / Math.max(1, sideCount - 1), tableType, 90);
    }
    while (tables.length < tableCount) add(0.5, 0.8, tableType, 0);
  } else if (layoutType === "rows") {
    const rows = 4;
    for (let row = 0; row < rows; row += 1) {
      const y = 0.18 + row * 0.19;
      add(0.17, y);
      add(0.30, y);
      add(0.70, y);
      add(0.83, y);
    }
  } else {
    const groupCount = Math.max(3, Math.ceil(classSize / 6));
    const columns = Math.min(3, groupCount);
    const rows = Math.ceil(groupCount / columns);
    for (let group = 0; group < groupCount; group += 1) {
      const col = group % columns;
      const row = Math.floor(group / columns);
      const centerX = 0.22 + col * (0.56 / Math.max(1, columns - 1));
      const centerY = 0.25 + row * (0.42 / Math.max(1, rows - 1));
      add(centerX - 0.065, centerY, "double", 90);
      add(centerX + 0.065, centerY, "double", 90);
      add(centerX, centerY + 0.09, "double", 0);
    }
  }

  const seats = makeSeats(tables);
  const state: SeatingState = {
    layoutType,
    classSize,
    tables,
    seats,
    nextTableNumber: tableNumber,
    nextSeatNumber: seats.length + 1,
  };
  return randomizeAssignments ? distribute(state) : state;
}

function distribute(state: SeatingState): SeatingState {
  const capacity = state.seats.length;
  const numbers = shuffle(Array.from({ length: state.classSize }, (_, index) => index + 1));
  const selectedSeatIds = new Set(shuffle(state.seats.map((seat) => seat.id)).slice(0, Math.min(capacity, state.classSize)));
  let numberIndex = 0;
  return {
    ...state,
    seats: state.seats.map((seat) => ({ ...seat, assigned: selectedSeatIds.has(seat.id) ? numbers[numberIndex++] ?? null : null })),
  };
}

function tableCapacity(type: TableType) {
  return type === "double" ? 2 : 1;
}

export default function Home() {
  const [state, setState] = useState<SeatingState>(() => createLayout("horseshoe", 18, "double", false));
  const [hydrated, setHydrated] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [selectedSeatId, setSelectedSeatId] = useState<number | null>(null);
  const [drag, setDrag] = useState<DragState>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      // The first render is deterministic for SSR; browser-local state is loaded immediately after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored) setState(JSON.parse(stored) as SeatingState);
      else setState((current) => distribute(current));
    } catch {
      // A corrupted or unavailable browser store should not block the app.
      setState((current) => distribute(current));
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, hydrated]);

  const capacity = state.seats.length;
  const emptyCount = Math.max(0, capacity - state.classSize);
  const selectedTable = state.tables.find((table) => table.id === selectedTableId) ?? null;
  const capacityMessage = state.classSize > capacity ? `Es fehlen ${state.classSize - capacity} Plätze.` : "";

  const seatsByTable = useMemo(() => {
    const map = new Map<string, Seat[]>();
    state.seats.forEach((seat) => map.set(seat.tableId, [...(map.get(seat.tableId) ?? []), seat]));
    return map;
  }, [state.seats]);

  function newLayout() {
    if (state.classSize < 1 || state.classSize > 30) return;
    const next = createLayout(state.layoutType, state.classSize);
    setState(next);
    setSelectedTableId(null);
    setSelectedSeatId(null);
  }

  function randomize() {
    if (state.classSize > capacity) return;
    setState(distribute(state));
    setSelectedSeatId(null);
  }

  function setClassSize(value: number) {
    const nextSize = Math.max(1, Math.min(30, Number.isFinite(value) ? value : 1));
    setState((current) => ({ ...current, classSize: nextSize }));
  }

  function changeLayout(value: LayoutType) {
    setState((current) => ({ ...current, layoutType: value }));
  }

  function startDrag(event: PointerEvent<HTMLDivElement>, table: Table) {
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pointerX = ((event.clientX - rect.left) / rect.width) * 100;
    const pointerY = ((event.clientY - rect.top) / rect.height) * 100;
    setSelectedTableId(table.id);
    setDrag({ tableId: table.id, dx: pointerX - table.x * 100, dy: pointerY - table.y * 100 });
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pointerX = ((event.clientX - rect.left) / rect.width) * 100;
    const pointerY = ((event.clientY - rect.top) / rect.height) * 100;
    setState((current) => ({
      ...current,
      tables: current.tables.map((table) =>
        table.id === drag.tableId
          ? { ...table, x: Math.max(0.06, Math.min(0.94, (pointerX - drag.dx) / 100)), y: Math.max(0.08, Math.min(0.92, (pointerY - drag.dy) / 100)) }
          : table,
      ),
    }));
  }

  function endDrag() {
    setDrag(null);
  }

  function rotateSelected() {
    if (!selectedTableId) return;
    setState((current) => ({ ...current, tables: current.tables.map((table) => table.id === selectedTableId ? { ...table, rotation: (table.rotation + 90) % 360 } : table) }));
  }

  function toggleSelectedCapacity() {
    if (!selectedTableId) return;
    setState((current) => {
      const table = current.tables.find((item) => item.id === selectedTableId);
      if (!table) return current;
      const type: TableType = table.type === "double" ? "single" : "double";
      const tables = current.tables.map((item) => item.id === selectedTableId ? { ...item, type } : item);
      const seats = makeSeats(tables, current.seats);
      return { ...current, tables, seats, nextSeatNumber: seats.length + 1 };
    });
  }

  function addTable(type: TableType) {
    const x = 0.5 + (Math.random() - 0.5) * 0.2;
    const y = 0.5 + (Math.random() - 0.5) * 0.2;
    const table: Table = { id: `T${state.nextTableNumber}`, type, x, y, rotation: 0 };
    const seats = makeSeats([...state.tables, table], state.seats);
    setState({ ...state, tables: [...state.tables, table], seats, nextTableNumber: state.nextTableNumber + 1, nextSeatNumber: seats.length + 1 });
    setSelectedTableId(table.id);
  }

  function deleteSelected() {
    if (!selectedTableId) return;
    const tables = state.tables.filter((table) => table.id !== selectedTableId);
    const seats = makeSeats(tables, state.seats.filter((seat) => seat.tableId !== selectedTableId));
    setState({ ...state, tables, seats, nextSeatNumber: seats.length + 1 });
    setSelectedTableId(null);
  }

  function clickSeat(seat: Seat) {
    if (selectedSeatId === null) {
      setSelectedSeatId(seat.id);
      return;
    }
    if (selectedSeatId === seat.id) {
      setSelectedSeatId(null);
      return;
    }
    setState((current) => ({ ...current, seats: current.seats.map((item) => item.id === selectedSeatId ? { ...item, assigned: current.seats.find((other) => other.id === seat.id)?.assigned ?? null } : item.id === seat.id ? { ...item, assigned: current.seats.find((other) => other.id === selectedSeatId)?.assigned ?? null } : item) }));
    setSelectedSeatId(null);
  }

  function exportPng() {
    const canvas = document.createElement("canvas");
    const scale = 2;
    canvas.width = STAGE_W * scale;
    canvas.height = STAGE_H * scale;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(scale, scale);
    context.fillStyle = "#f7f5f0";
    context.fillRect(0, 0, STAGE_W, STAGE_H);
    context.fillStyle = "#1f2937";
    context.font = "600 24px Arial";
    context.fillText("Sitzordnung", 32, 42);
    context.font = "14px Arial";
    context.fillStyle = "#667085";
    context.fillText(`${layoutLabels[state.layoutType]} · ${state.classSize} Schüler*innen · ${capacity} Plätze`, 32, 66);
    context.strokeStyle = "#d6d3cc";
    context.strokeRect(20, 88, STAGE_W - 40, STAGE_H - 108);
    context.fillStyle = "#cfd8df";
    context.fillRect(STAGE_W / 2 - 55, STAGE_H - 58, 110, 24);
    context.fillStyle = "#344054";
    context.font = "600 12px Arial";
    context.textAlign = "center";
    context.fillText("LEHRERPULT", STAGE_W / 2, STAGE_H - 42);
    state.tables.forEach((table) => {
      const x = table.x * STAGE_W;
      const y = table.y * STAGE_H;
      context.save();
      context.translate(x, y);
      context.rotate((table.rotation * Math.PI) / 180);
      const width = table.type === "double" ? 88 : 62;
      const height = 48;
      context.fillStyle = "#2f8f87";
      context.roundRect(-width / 2, -height / 2, width, height, 12);
      context.fill();
      context.fillStyle = "#ffffff";
      context.font = "600 11px Arial";
      context.fillText(table.id, 0, 4);
      const seats = seatsByTable.get(table.id) ?? [];
      seats.forEach((seat, index) => {
        const seatX = table.type === "double" ? (index === 0 ? -58 : 58) : 0;
        const seatY = 0;
        context.beginPath();
        context.arc(seatX, seatY, 17, 0, Math.PI * 2);
        context.fillStyle = seat.assigned === null ? "#e9e6df" : "#fffaf0";
        context.fill();
        context.strokeStyle = "#d0cbc1";
        context.stroke();
        context.fillStyle = "#344054";
        context.font = "600 11px Arial";
        context.fillText(seat.assigned === null ? "—" : String(seat.assigned), seatX, 4);
      });
      context.restore();
    });
    context.textAlign = "start";
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "sitzordnung.png";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      window.setTimeout(() => {
        link.remove();
        URL.revokeObjectURL(url);
      }, 250);
    }, "image/png");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">□</span>
          <div>
          <p className="eyebrow">Unterrichtswerkzeug</p>
            <h1>Sitzordnung</h1>
          </div>
        </div>
        <div className="topbar-actions no-print">
          <span className="saved-status"><span className="status-dot" /> automatisch gespeichert</span>
          <button className="button button-ghost" onClick={exportPng}>PNG exportieren</button>
          <button className="button button-primary" onClick={() => window.print()}>Drucken / PDF</button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar no-print">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Konfiguration</p>
              <h2>Neue Sitzordnung</h2>
            </div>
            <span className="step-badge">01</span>
          </div>

          <label className="field-label" htmlFor="classSize">Klassengröße</label>
          <div className="number-field">
            <input id="classSize" type="number" min="1" max="30" value={state.classSize} onChange={(event) => setClassSize(Number(event.target.value))} />
            <span>von 30</span>
          </div>

          <label className="field-label" htmlFor="layoutType">Sitzordnung</label>
          <select id="layoutType" className="select-field" value={state.layoutType} onChange={(event) => changeLayout(event.target.value as LayoutType)}>
            <option value="horseshoe">Hufeisen / U-Form</option>
            <option value="rows">Reihen mit Mittelgang</option>
            <option value="groups">Gruppentische</option>
          </select>

          <div className="template-note">
            <span className="note-icon">i</span>
            <p>{state.layoutType === "horseshoe" ? "Automatisch: Hufeisen mit mindestens 20 Plätzen." : state.layoutType === "rows" ? "Vorlage: vier Reihen, Mittelgang, je zwei Doppeltische pro Seite." : "Vorlage: Gruppen aus maximal drei Doppeltischen mit bis zu sechs Plätzen."}</p>
          </div>

          <button className="button button-primary button-wide" onClick={newLayout}>Neue Sitzordnung anlegen <span>→</span></button>

          <div className="divider" />
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">Schritt 02</p>
              <h2>Zahlen verteilen</h2>
            </div>
          </div>
          <p className="helper-text">Jede Zahl von 1 bis {state.classSize} wird höchstens einmal vergeben. Leere Plätze werden zufällig verteilt.</p>
          <button className="button button-dark button-wide" disabled={state.classSize > capacity} onClick={randomize}>Neu erzeugen <span>↻</span></button>
          {capacityMessage && <p className="warning">{capacityMessage} Lege weitere Tische an oder wähle eine kleinere Klasse.</p>}

          <div className="divider" />
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">Bearbeiten</p>
              <h2>Tische & Plätze</h2>
            </div>
          </div>
          <div className="edit-actions">
            <button className="mini-button" onClick={() => addTable("double")}>+ Doppeltisch</button>
            <button className="mini-button" onClick={() => addTable("single")}>+ Einzeltisch</button>
          </div>
          {selectedTable && (
            <div className="selection-card">
              <div><strong>{selectedTable.id}</strong><span>{tableCapacity(selectedTable.type)} {tableCapacity(selectedTable.type) === 1 ? "Platz" : "Plätze"}</span></div>
              <div className="edit-actions">
                <button className="mini-button" onClick={toggleSelectedCapacity}>zu {selectedTable.type === "double" ? "Einzeltisch" : "Doppeltisch"}</button>
                <button className="mini-button" onClick={rotateSelected}>90° drehen</button>
                <button className="mini-button danger-button" onClick={deleteSelected}>löschen</button>
              </div>
            </div>
          )}
          <p className="helper-text">Tische direkt auf der Fläche ziehen. Zum Tauschen zwei Plätze nacheinander anklicken.</p>
        </aside>

        <section className="canvas-area">
          <div className="canvas-toolbar">
            <div>
              <p className="eyebrow">Arbeitsfläche · Lehrersicht</p>
              <h2>{layoutLabels[state.layoutType]}</h2>
            </div>
            <div className="canvas-stats">
              <span><strong>{state.tables.length}</strong> Tische</span>
              <span><strong>{capacity}</strong> Plätze</span>
              <span><strong>{emptyCount}</strong> leer</span>
            </div>
          </div>
          <div className="view-hint"><span className="front-marker">← vorne / Lehrerpult</span><span>Rückwand →</span></div>
          <div ref={stageRef} className="stage" onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
            <div className="room-label">RÜCKWAND</div>
            <div className="teacher-desk">LEHRERPULT</div>
            {state.tables.map((table) => {
              const selected = selectedTableId === table.id;
              const tableStyle = { left: `${table.x * 100}%`, top: `${table.y * 100}%`, transform: `translate(-50%, -50%) rotate(${table.rotation}deg)` } as CSSProperties;
              return (
                <div key={table.id} className={`table-cluster ${table.type} ${selected ? "selected" : ""}`} style={tableStyle} onPointerDown={(event) => startDrag(event, table)}>
                  <div className="table-caption">{table.id}</div>
                  <div className="table-body"><span className="table-label">{table.type === "double" ? "DOPPELTISCH" : "EINZELTISCH"}</span></div>
                  <div className="seat-row">
                    {(seatsByTable.get(table.id) ?? []).map((seat) => (
                      <button key={seat.id} className={`seat ${seat.assigned === null ? "empty" : ""} ${selectedSeatId === seat.id ? "seat-selected" : ""}`} title={`Platz ${seat.id}`} onClick={() => clickSeat(seat)}>
                        <span className="seat-id">P{seat.id}</span>
                        <span className="seat-number">{seat.assigned ?? "—"}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <div className="stage-footer">Platznummern bleiben bei der nächsten Verteilung unverändert · Lehrersicht</div>
          </div>
          <div className="legend">
            <span><i className="legend-dot filled" /> Nummer vergeben</span>
            <span><i className="legend-dot empty-dot" /> leerer Platz</span>
            <span><i className="legend-dot selected-dot" /> ausgewählt / tauschen</span>
          </div>
        </section>
      </div>
    </main>
  );
}
