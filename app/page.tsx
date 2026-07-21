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
  targetSeats: number;
  tables: Table[];
  seats: Seat[];
  nextTableNumber: number;
  nextSeatNumber: number;
};

type DragState = { tableId: string; dx: number; dy: number } | null;
type NumberField = "classSize" | "targetSeats";

const STORAGE_KEY = "sitzordnung-randomizer-v1";
const STAGE_W = 1000;
const STAGE_H = 680;
const DEFAULT_CLASS_SIZE = 18;
const DEFAULT_TOTAL_SEATS = 20;
const HORSESHOE_FRONT_LIMIT_Y = 0.72;
const HORSESHOE_FRONT_MIN_X = 0.3;
const HORSESHOE_FRONT_MAX_X = 0.7;
const EXPORT_LEFT = 32;
const EXPORT_RIGHT = STAGE_W - 32;
const EXPORT_TOP = 32;
const EXPORT_BOTTOM = STAGE_H - 92;

type ExportPlacement = Table & { width: number; height: number; scale: number };

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

function asPositiveInteger(value: number, fallback: number) {
  return Math.max(1, Math.floor(Number.isFinite(value) ? value : fallback));
}

function parsePositiveIntegerInput(value: string) {
  if (!/^\d+$/.test(value.trim())) return null;
  return Math.max(1, Math.floor(Number(value)));
}

function tableTypesForCapacity(totalSeats: number) {
  const normalized = asPositiveInteger(totalSeats, DEFAULT_TOTAL_SEATS);
  const types = Array.from({ length: Math.floor(normalized / 2) }, () => "double" as TableType);
  if (normalized % 2 === 1) types.push("single");
  return types.length ? types : (["single"] as TableType[]);
}

function horseshoePosition(index: number, tableCount: number) {
  const topCount = Math.max(1, Math.ceil(tableCount / 2));
  const sideCount = tableCount - topCount;
  const leftCount = Math.ceil(sideCount / 2);

  if (index < topCount) {
    return {
      x: topCount === 1 ? 0.5 : 0.16 + (index * 0.68) / (topCount - 1),
      y: 0.18,
      rotation: 0,
    };
  }

  const sideIndex = index - topCount;
  const isLeft = sideIndex < leftCount;
  const indexOnSide = isLeft ? sideIndex : sideIndex - leftCount;
  const countOnSide = isLeft ? leftCount : sideCount - leftCount;

  return {
    x: isLeft ? 0.12 : 0.88,
    y: 0.36 + (indexOnSide * 0.34) / Math.max(1, countOnSide - 1),
    rotation: 90,
  };
}

function arrangeHorseshoeTables(tables: Table[]) {
  return tables.map((table, index) => ({ ...table, ...horseshoePosition(index, tables.length) }));
}

function constrainTablePosition(layoutType: LayoutType, x: number, y: number) {
  const clamped = {
    x: Math.max(0.06, Math.min(0.94, x)),
    y: Math.max(0.08, Math.min(0.92, y)),
  };

  if (
    layoutType === "horseshoe" &&
    clamped.y > HORSESHOE_FRONT_LIMIT_Y &&
    clamped.x >= HORSESHOE_FRONT_MIN_X &&
    clamped.x <= HORSESHOE_FRONT_MAX_X
  ) {
    return { ...clamped, y: HORSESHOE_FRONT_LIMIT_Y };
  }

  return clamped;
}

function exportFootprint(table: Table, scale: number) {
  const isSideways = table.rotation % 180 !== 0;
  // A single seat sits below its tabletop, so use a symmetric bound large
  // enough to cover that offset on either side of the table centre.
  const horizontal = table.type === "double" ? { width: 176, height: 64 } : { width: 72, height: 136 };
  return {
    width: (isSideways ? horizontal.height : horizontal.width) * scale,
    height: (isSideways ? horizontal.width : horizontal.height) * scale,
  };
}

function overlapsExportPlacement(a: ExportPlacement, b: ExportPlacement) {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.y - b.y) < (a.height + b.height) / 2;
}

function createExportPlacements(tables: Table[]): ExportPlacement[] {
  const gridStep = 8;
  const scales = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1];

  for (const scale of scales) {
    const placed: ExportPlacement[] = [];
    let canPlaceEveryTable = true;

    for (const table of tables) {
      const footprint = exportFootprint(table, scale);
      const minX = EXPORT_LEFT + footprint.width / 2;
      const maxX = EXPORT_RIGHT - footprint.width / 2;
      const minY = EXPORT_TOP + footprint.height / 2;
      const maxY = EXPORT_BOTTOM - footprint.height / 2;
      let best: ExportPlacement | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (let y = minY; y <= maxY; y += gridStep) {
        for (let x = minX; x <= maxX; x += gridStep) {
          const candidate = { ...table, x, y, ...footprint, scale };
          if (placed.some((other) => overlapsExportPlacement(candidate, other))) continue;
          const distance = (x - table.x * STAGE_W) ** 2 + (y - table.y * STAGE_H) ** 2;
          if (distance < bestDistance) {
            best = candidate;
            bestDistance = distance;
          }
        }
      }

      if (!best) {
        canPlaceEveryTable = false;
        break;
      }
      placed.push(best);
    }

    if (canPlaceEveryTable) return placed;
  }

  // This is only reached for an exceptionally large plan. A fixed cell size
  // keeps every rendered footprint separate even when the page is overfull.
  return tables.map((table, index) => {
    const scale = 0.1;
    const footprint = exportFootprint(table, scale);
    const cellWidth = 18;
    const cellHeight = 18;
    const columns = Math.max(1, Math.floor((EXPORT_RIGHT - EXPORT_LEFT) / cellWidth));
    return {
      ...table,
      x: EXPORT_LEFT + cellWidth / 2 + (index % columns) * cellWidth,
      y: EXPORT_TOP + cellHeight / 2 + Math.floor(index / columns) * cellHeight,
      ...footprint,
      scale,
    };
  });
}

function createLayout(layoutType: LayoutType, classSize: number, targetSeats: number, randomizeAssignments = true): SeatingState {
  const tables: Table[] = [];
  let tableNumber = 1;
  const tableTypes = tableTypesForCapacity(targetSeats);
  let typeIndex = 0;

  const add = (x: number, y: number, type = tableTypes[typeIndex] ?? "double", rotation = 0) => {
    tables.push({ id: `T${tableNumber}`, type, x, y, rotation });
    tableNumber += 1;
    typeIndex += 1;
  };

  if (layoutType === "horseshoe") {
    const tableCount = tableTypes.length;
    for (let i = 0; i < tableCount; i += 1) {
      const position = horseshoePosition(i, tableCount);
      add(position.x, position.y, undefined, position.rotation);
    }
  } else if (layoutType === "rows") {
    const rows = Math.ceil(tableTypes.length / 4);
    const xs = [0.17, 0.30, 0.70, 0.83];
    for (let row = 0; row < rows; row += 1) {
      const y = 0.16 + (row * 0.66) / Math.max(1, rows - 1);
      for (const x of xs) {
        if (tables.length < tableTypes.length) add(x, y);
      }
    }
  } else {
    const groupCount = Math.ceil(tableTypes.length / 3);
    const columns = Math.min(3, groupCount);
    const rows = Math.ceil(groupCount / columns);
    for (let group = 0; group < groupCount; group += 1) {
      const col = group % columns;
      const row = Math.floor(group / columns);
      const centerX = 0.22 + col * (0.56 / Math.max(1, columns - 1));
      const centerY = 0.25 + row * (0.42 / Math.max(1, rows - 1));
      if (tables.length < tableTypes.length) add(centerX - 0.065, centerY);
      if (tables.length < tableTypes.length) add(centerX + 0.065, centerY);
      if (tables.length < tableTypes.length) add(centerX, centerY + 0.09, undefined, 0);
    }
  }

  const seats = makeSeats(tables);
  const state: SeatingState = {
    layoutType,
    classSize: asPositiveInteger(classSize, DEFAULT_CLASS_SIZE),
    targetSeats: asPositiveInteger(targetSeats, DEFAULT_TOTAL_SEATS),
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

function totalCapacity(tables: Table[]) {
  return tables.reduce((sum, table) => sum + tableCapacity(table.type), 0);
}

function syncCapacity(current: SeatingState, targetSeats: number): SeatingState {
  const normalized = asPositiveInteger(targetSeats, current.targetSeats);
  let tables = [...current.tables];
  let nextTableNumber = current.nextTableNumber;

  while (totalCapacity(tables) < normalized) {
    const remaining = normalized - totalCapacity(tables);
    tables.push({
      id: `T${nextTableNumber}`,
      type: remaining === 1 ? "single" : "double",
      x: 0.5 + (Math.random() - 0.5) * 0.2,
      y: 0.5 + (Math.random() - 0.5) * 0.2,
      rotation: 0,
    });
    nextTableNumber += 1;
  }

  while (totalCapacity(tables) > normalized && tables.length > 0) {
    const overflow = totalCapacity(tables) - normalized;
    const last = tables[tables.length - 1];
    if (overflow === 1 && last.type === "double") {
      tables[tables.length - 1] = { ...last, type: "single" };
      break;
    }
    tables.pop();
  }

  if (current.layoutType === "horseshoe") {
    tables = arrangeHorseshoeTables(tables);
  }

  const seats = makeSeats(tables, current.seats);
  return { ...current, targetSeats: normalized, tables, seats, nextTableNumber, nextSeatNumber: seats.length + 1 };
}

function normalizeStoredState(stored: SeatingState): SeatingState {
  const targetSeats = asPositiveInteger(stored.targetSeats ?? stored.seats?.length, DEFAULT_TOTAL_SEATS);
  const storedTables = stored.tables ?? [];
  const tables = stored.layoutType === "horseshoe" ? arrangeHorseshoeTables(storedTables) : storedTables;
  const seats = makeSeats(tables, stored.seats);

  return {
    ...stored,
    classSize: asPositiveInteger(stored.classSize, DEFAULT_CLASS_SIZE),
    targetSeats,
    tables,
    seats,
    nextTableNumber: stored.nextTableNumber ?? tables.length + 1,
    nextSeatNumber: seats.length + 1,
  };
}

export default function Home() {
  const [state, setState] = useState<SeatingState>(() => createLayout("horseshoe", DEFAULT_CLASS_SIZE, DEFAULT_TOTAL_SEATS, false));
  const [hydrated, setHydrated] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [selectedSeatId, setSelectedSeatId] = useState<number | null>(null);
  const [focusedNumberField, setFocusedNumberField] = useState<NumberField | null>(null);
  const [classSizeInput, setClassSizeInput] = useState(String(DEFAULT_CLASS_SIZE));
  const [targetSeatsInput, setTargetSeatsInput] = useState(String(DEFAULT_TOTAL_SEATS));
  const [drag, setDrag] = useState<DragState>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      // The first render is deterministic for SSR; browser-local state is loaded immediately after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored) {
        const parsed = JSON.parse(stored) as SeatingState;
        setState(normalizeStoredState(parsed));
      }
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

  useEffect(() => {
    // Keep editable drafts in sync with table edits, saved state, and layout changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (focusedNumberField !== "classSize") setClassSizeInput(String(state.classSize));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (focusedNumberField !== "targetSeats") setTargetSeatsInput(String(state.targetSeats));
  }, [focusedNumberField, state.classSize, state.targetSeats]);

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
    if (state.classSize < 1 || state.targetSeats < 1) return;
    const next = createLayout(state.layoutType, state.classSize, state.targetSeats);
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
    const nextSize = asPositiveInteger(value, state.classSize);
    setState((current) => ({ ...current, classSize: nextSize }));
  }

  function setTargetSeats(value: number) {
    setState((current) => syncCapacity(current, value));
    setSelectedTableId(null);
    setSelectedSeatId(null);
  }

  function changeClassSizeInput(value: string) {
    setClassSizeInput(value);
    const nextSize = parsePositiveIntegerInput(value);
    if (nextSize !== null) {
      setState((current) => ({ ...current, classSize: nextSize }));
    }
  }

  function commitClassSizeInput() {
    const nextSize = parsePositiveIntegerInput(classSizeInput) ?? state.classSize;
    setClassSize(nextSize);
    setClassSizeInput(String(nextSize));
    setFocusedNumberField(null);
  }

  function changeTargetSeatsInput(value: string) {
    setTargetSeatsInput(value);
    const nextSeats = parsePositiveIntegerInput(value);
    if (nextSeats !== null) {
      setTargetSeats(nextSeats);
    }
  }

  function commitTargetSeatsInput() {
    const nextSeats = parsePositiveIntegerInput(targetSeatsInput) ?? state.targetSeats;
    setTargetSeats(nextSeats);
    setTargetSeatsInput(String(nextSeats));
    setFocusedNumberField(null);
  }

  function changeLayout(value: LayoutType) {
    setState((current) => {
      if (value !== "horseshoe") return { ...current, layoutType: value };

      const tables = arrangeHorseshoeTables(current.tables);
      const seats = makeSeats(tables, current.seats);
      return { ...current, layoutType: value, targetSeats: seats.length, tables, seats, nextSeatNumber: seats.length + 1 };
    });
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
      tables: current.tables.map((table) => {
        if (table.id !== drag.tableId) return table;
        const position = constrainTablePosition(current.layoutType, (pointerX - drag.dx) / 100, (pointerY - drag.dy) / 100);
        return { ...table, ...position };
      }),
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
      const tables = current.layoutType === "horseshoe"
        ? arrangeHorseshoeTables(current.tables.map((item) => item.id === selectedTableId ? { ...item, type } : item))
        : current.tables.map((item) => item.id === selectedTableId ? { ...item, type } : item);
      const seats = makeSeats(tables, current.seats);
      return { ...current, targetSeats: seats.length, tables, seats, nextSeatNumber: seats.length + 1 };
    });
  }

  function addTable(type: TableType) {
    const x = 0.5 + (Math.random() - 0.5) * 0.2;
    const y = 0.5 + (Math.random() - 0.5) * 0.2;
    const table: Table = { id: `T${state.nextTableNumber}`, type, x, y, rotation: 0 };
    const tables = state.layoutType === "horseshoe" ? arrangeHorseshoeTables([...state.tables, table]) : [...state.tables, table];
    const seats = makeSeats(tables, state.seats);
    setState({ ...state, targetSeats: seats.length, tables, seats, nextTableNumber: state.nextTableNumber + 1, nextSeatNumber: seats.length + 1 });
    setSelectedTableId(table.id);
  }

  function deleteSelected() {
    if (!selectedTableId) return;
    const tables = state.layoutType === "horseshoe"
      ? arrangeHorseshoeTables(state.tables.filter((table) => table.id !== selectedTableId))
      : state.tables.filter((table) => table.id !== selectedTableId);
    const seats = makeSeats(tables, state.seats.filter((seat) => seat.tableId !== selectedTableId));
    setState({ ...state, targetSeats: seats.length, tables, seats, nextSeatNumber: seats.length + 1 });
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
    context.strokeStyle = "#d6d3cc";
    context.strokeRect(20, 20, STAGE_W - 40, STAGE_H - 40);
    context.fillStyle = "#cfd8df";
    context.fillRect(STAGE_W / 2 - 55, STAGE_H - 58, 110, 24);
    context.fillStyle = "#344054";
    context.font = "600 12px Arial";
    context.textAlign = "center";
    context.fillText("LEHRERPULT", STAGE_W / 2, STAGE_H - 42);
    createExportPlacements(state.tables).forEach((table) => {
      context.save();
      context.translate(table.x, table.y);
      context.rotate((table.rotation * Math.PI) / 180);
      context.scale(table.scale, table.scale);
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
        const seatX = table.type === "double" ? (index === 0 ? -67 : 67) : 0;
        const seatY = table.type === "double" ? 0 : 48;
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
            <input
              id="classSize"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={classSizeInput}
              onFocus={() => setFocusedNumberField("classSize")}
              onBlur={commitClassSizeInput}
              onChange={(event) => changeClassSizeInput(event.target.value)}
            />
            <span>Schüler*innen</span>
          </div>

          <label className="field-label" htmlFor="targetSeats">Plätze gesamt</label>
          <div className="number-field">
            <input
              id="targetSeats"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={targetSeatsInput}
              onFocus={() => setFocusedNumberField("targetSeats")}
              onBlur={commitTargetSeatsInput}
              onChange={(event) => changeTargetSeatsInput(event.target.value)}
            />
            <span>{capacity} aktuell</span>
          </div>

          <label className="field-label" htmlFor="layoutType">Sitzordnung</label>
          <select id="layoutType" className="select-field" value={state.layoutType} onChange={(event) => changeLayout(event.target.value as LayoutType)}>
            <option value="horseshoe">Hufeisen / U-Form</option>
            <option value="rows">Reihen mit Mittelgang</option>
            <option value="groups">Gruppentische</option>
          </select>

          <div className="template-note">
            <span className="note-icon">i</span>
            <p>{state.layoutType === "horseshoe" ? "Automatisch: Hufeisen mit der gewählten Gesamtzahl an Plätzen." : state.layoutType === "rows" ? "Vorlage: Reihen mit Mittelgang und der gewählten Gesamtzahl an Plätzen." : "Vorlage: Gruppen aus Doppeltischen mit der gewählten Gesamtzahl an Plätzen."}</p>
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
