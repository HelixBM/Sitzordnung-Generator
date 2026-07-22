"use client";

import { CSSProperties, KeyboardEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";

type LayoutType = "horseshoe" | "rows" | "groups";
type TableType = "double" | "single";

type Seat = {
  id: number;
  tableId: string;
  slot: number;
  assigned: number | null;
  locked?: boolean;
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
  studentNames?: string[];
  displayMode?: "numbers" | "names";
  planName?: string;
};

type DragState = { tableId: string; dx: number; dy: number } | null;
type NumberField = "classSize" | "targetSeats";

const STORAGE_KEY = "sitzordnung-randomizer-v2";
const PLANS_KEY = "sitzordnung-randomizer-plans-v1";
const STAGE_W = 1000;
const STAGE_H = 680;
const DEFAULT_CLASS_SIZE = 18;
const DEFAULT_TOTAL_SEATS = 20;
const HORSESHOE_FRONT_LIMIT_Y = 0.72;
const HORSESHOE_FRONT_MIN_X = 0.3;
const HORSESHOE_FRONT_MAX_X = 0.7;


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
  const oldAssignments = new Map((previous ?? []).map((seat) => [`${seat.tableId}:${seat.slot}`, seat]));
  let id = 1;
  return tables.flatMap((table) => {
    const count = table.type === "double" ? 2 : 1;
    return Array.from({ length: count }, (_, slot) => ({
      id: id++,
      tableId: table.id,
      slot,
      assigned: oldAssignments.get(`${table.id}:${slot}`)?.assigned ?? null,
      locked: oldAssignments.get(`${table.id}:${slot}`)?.locked ?? false,
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

function groupPosition(index: number, tableCount: number) {
  const groupCount = Math.ceil(tableCount / 3);
  const columns = Math.min(3, groupCount);
  const group = Math.floor(index / 3);
  const member = index % 3;
  const col = group % columns;
  const row = Math.floor(group / columns);
  const rows = Math.ceil(groupCount / columns);
  const centerX = 0.22 + col * (0.56 / Math.max(1, columns - 1));
  const centerY = 0.25 + row * (0.42 / Math.max(1, rows - 1));

  // Keep a visible gap between clusters: their seats extend to the full
  // cluster width, so the desk bodies alone are not a sufficient spacing cue.
  if (member === 0) return { x: centerX - 0.075, y: centerY, rotation: 0 };
  if (member === 1) return { x: centerX + 0.075, y: centerY, rotation: 0 };
  return { x: centerX, y: centerY + 0.11, rotation: 0 };
}

function arrangeGroupTables(tables: Table[]) {
  return tables.map((table, index) => ({ ...table, ...groupPosition(index, tables.length) }));
}

function arrangeTablesForLayout(layoutType: LayoutType, tables: Table[]) {
  if (layoutType === "horseshoe") return arrangeHorseshoeTables(tables);
  if (layoutType === "groups") return arrangeGroupTables(tables);
  return tables;
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
    for (let i = 0; i < tableTypes.length; i += 1) {
      const position = groupPosition(i, tableTypes.length);
      add(position.x, position.y, undefined, position.rotation);
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
  const lockedNumbers = state.seats.filter((seat) => seat.locked && seat.assigned !== null).map((seat) => seat.assigned as number);
  const numbers = shuffle(Array.from({ length: state.classSize }, (_, index) => index + 1).filter((number) => !lockedNumbers.includes(number)));
  const availableSeats = shuffle(state.seats.filter((seat) => !seat.locked).map((seat) => seat.id));
  const selectedSeatIds = new Set(availableSeats.slice(0, Math.min(availableSeats.length, state.classSize - lockedNumbers.length)));
  let numberIndex = 0;
  return {
    ...state,
    seats: state.seats.map((seat) => seat.locked ? seat : ({ ...seat, assigned: selectedSeatIds.has(seat.id) ? numbers[numberIndex++] ?? null : null })),
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

  tables = arrangeTablesForLayout(current.layoutType, tables);

  const seats = makeSeats(tables, current.seats);
  return { ...current, targetSeats: normalized, tables, seats, nextTableNumber, nextSeatNumber: seats.length + 1 };
}

function normalizeStoredState(stored: SeatingState): SeatingState {
  const targetSeats = asPositiveInteger(stored.targetSeats ?? stored.seats?.length, DEFAULT_TOTAL_SEATS);
  const storedTables = stored.tables ?? [];
  const tables = arrangeTablesForLayout(stored.layoutType, storedTables);
  const seats = makeSeats(tables, stored.seats);

  return {
    ...stored,
    classSize: asPositiveInteger(stored.classSize, DEFAULT_CLASS_SIZE),
    targetSeats,
    tables,
    seats,
    nextTableNumber: stored.nextTableNumber ?? tables.length + 1,
    nextSeatNumber: seats.length + 1,
    studentNames: stored.studentNames ?? [],
    displayMode: stored.displayMode ?? "numbers",
    planName: stored.planName ?? "Aktuelle Sitzordnung",
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
  const [announcement, setAnnouncement] = useState("");
  const [history, setHistory] = useState<SeatingState[]>([]);
  const [future, setFuture] = useState<SeatingState[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const previousState = useRef<SeatingState | null>(null);
  const restoringHistory = useRef(false);

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
    if (!hydrated) return;
    if (previousState.current && !restoringHistory.current) {
      setHistory((items) => [...items.slice(-29), previousState.current as SeatingState]);
      setFuture([]);
    }
    previousState.current = state;
    restoringHistory.current = false;
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
  const studentNames = state.studentNames ?? [];
  const usesNames = state.displayMode === "names";

  function studentLabel(number: number | null) {
    if (number === null) return "—";
    return usesNames && studentNames[number - 1]?.trim() ? studentNames[number - 1].trim() : String(number);
  }

  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    restoringHistory.current = true;
    setHistory((items) => items.slice(0, -1));
    setFuture((items) => [state, ...items].slice(0, 30));
    setState(previous);
    setAnnouncement("Änderung rückgängig gemacht.");
  }

  function redo() {
    const next = future[0];
    if (!next) return;
    restoringHistory.current = true;
    setFuture((items) => items.slice(1));
    setHistory((items) => [...items, state].slice(-30));
    setState(next);
    setAnnouncement("Änderung wiederhergestellt.");
  }

  function updateNames(value: string) {
    const names = value.split(/\r?\n/).map((name) => name.trim());
    const count = names.filter(Boolean).length;
    setState((current) => ({ ...current, studentNames: names, classSize: count || current.classSize }));
  }

  function savePlan() {
    const name = window.prompt("Name der gespeicherten Sitzordnung:", state.planName ?? "Sitzordnung");
    if (!name?.trim()) return;
    const plan = { ...state, planName: name.trim() };
    const plans = JSON.parse(window.localStorage.getItem(PLANS_KEY) ?? "[]") as SeatingState[];
    window.localStorage.setItem(PLANS_KEY, JSON.stringify([...plans.filter((item) => item.planName !== plan.planName), plan]));
    setState(plan);
    setAnnouncement(`„${plan.planName}“ wurde gespeichert.`);
  }

  function loadPlan() {
    const plans = JSON.parse(window.localStorage.getItem(PLANS_KEY) ?? "[]") as SeatingState[];
    if (!plans.length) { setAnnouncement("Noch keine gespeicherte Sitzordnung."); return; }
    const choices = plans.map((plan, index) => `${index + 1}: ${plan.planName ?? "Sitzordnung"}`).join("\n");
    const answer = window.prompt(`Welche Sitzordnung laden?\n${choices}`, "1");
    const selected = plans[Number(answer) - 1];
    if (selected) { setState(normalizeStoredState(selected)); setSelectedSeatId(null); setSelectedTableId(null); setAnnouncement("Gespeicherte Sitzordnung geladen."); }
  }

  function downloadBackup() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "sitzordnung-backup.json"; link.click(); URL.revokeObjectURL(url);
  }

  function restoreBackup(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const restored = normalizeStoredState(JSON.parse(String(reader.result)) as SeatingState);
        setState(restored); setSelectedSeatId(null); setSelectedTableId(null); setAnnouncement("Backup wiederhergestellt.");
      } catch { setAnnouncement("Die Datei ist kein gültiges Sitzordnungs-Backup."); }
    };
    reader.readAsText(file);
  }

  const seatsByTable = useMemo(() => {
    const map = new Map<string, Seat[]>();
    state.seats.forEach((seat) => map.set(seat.tableId, [...(map.get(seat.tableId) ?? []), seat]));
    return map;
  }, [state.seats]);

  function newLayout() {
    if (state.classSize < 1 || state.targetSeats < 1) return;
    const next = { ...createLayout(state.layoutType, state.classSize, state.targetSeats), studentNames: state.studentNames, displayMode: state.displayMode, planName: state.planName };
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
      const tables = arrangeTablesForLayout(value, current.tables);
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
      const tables = arrangeTablesForLayout(
        current.layoutType,
        current.tables.map((item) => item.id === selectedTableId ? { ...item, type } : item),
      );
      const seats = makeSeats(tables, current.seats);
      return { ...current, targetSeats: seats.length, tables, seats, nextSeatNumber: seats.length + 1 };
    });
  }

  function addTable(type: TableType) {
    const x = 0.5 + (Math.random() - 0.5) * 0.2;
    const y = 0.5 + (Math.random() - 0.5) * 0.2;
    const table: Table = { id: `T${state.nextTableNumber}`, type, x, y, rotation: 0 };
    const tables = arrangeTablesForLayout(state.layoutType, [...state.tables, table]);
    const seats = makeSeats(tables, state.seats);
    setState({ ...state, targetSeats: seats.length, tables, seats, nextTableNumber: state.nextTableNumber + 1, nextSeatNumber: seats.length + 1 });
    setSelectedTableId(table.id);
  }

  function deleteSelected() {
    if (!selectedTableId) return;
    const tables = arrangeTablesForLayout(state.layoutType, state.tables.filter((table) => table.id !== selectedTableId));
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

  function toggleSeatLock(seat: Seat) {
    setState((current) => ({ ...current, seats: current.seats.map((item) => item.id === seat.id ? { ...item, locked: !item.locked } : item) }));
    setAnnouncement(seat.locked ? "Platz entsperrt." : "Platz für die nächste Verteilung gesperrt.");
  }

  function moveSelectedTable(event: KeyboardEvent<HTMLDivElement>, table: Table) {
    if (event.target !== event.currentTarget) return;
    const step = event.shiftKey ? 0.03 : 0.01;
    const direction = event.key === "ArrowLeft" ? [-step, 0] : event.key === "ArrowRight" ? [step, 0] : event.key === "ArrowUp" ? [0, -step] : event.key === "ArrowDown" ? [0, step] : null;
    if (event.key === "r" || event.key === "R") { setSelectedTableId(table.id); setState((current) => ({ ...current, tables: current.tables.map((item) => item.id === table.id ? { ...item, rotation: (item.rotation + 90) % 360 } : item) })); event.preventDefault(); return; }
    if (!direction) return;
    event.preventDefault();
    setSelectedTableId(table.id);
    setState((current) => ({ ...current, tables: current.tables.map((item) => item.id === table.id ? { ...item, ...constrainTablePosition(current.layoutType, item.x + direction[0], item.y + direction[1]) } : item) }));
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
    context.fillStyle = "#344054";
    context.font = "700 20px Arial";
    context.textAlign = "left";
    context.fillText(state.planName ?? "Sitzordnung", 32, 42);
    state.tables.forEach((table) => {
      context.save();
      context.translate(table.x * STAGE_W, table.y * STAGE_H);
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
        const seatX = table.type === "double" ? (index === 0 ? -67 : 67) : 0;
        const seatY = table.type === "double" ? 0 : 48;
        context.beginPath();
        context.arc(seatX, seatY, 17, 0, Math.PI * 2);
        context.fillStyle = seat.assigned === null ? "#e9e6df" : "#fffaf0";
        context.fill();
        context.strokeStyle = "#d0cbc1";
        context.stroke();
        context.fillStyle = "#344054";
        context.font = usesNames ? "600 9px Arial" : "600 11px Arial";
        const label = studentLabel(seat.assigned);
        context.fillText(label.length > 13 ? `${label.slice(0, 12)}…` : label, seatX, 4);
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
          <button className="button button-ghost" disabled={!history.length} onClick={undo} aria-label="Rückgängig">↶</button>
          <button className="button button-ghost" disabled={!future.length} onClick={redo} aria-label="Wiederholen">↷</button>
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
          <details className="names-panel">
            <summary>Namen verwenden (optional)</summary>
            <p className="helper-text">Eine Zeile pro Schüler*in. Ohne Namen bleibt die Nummernansicht aktiv.</p>
            <textarea id="studentNames" className="names-input" value={studentNames.join("\n")} placeholder={"Anna Beispiel\nBen Muster"} onChange={(event) => updateNames(event.target.value)} />
            <label className="field-label" htmlFor="displayMode">Anzeige auf den Plätzen</label>
            <select id="displayMode" className="select-field" value={state.displayMode ?? "numbers"} onChange={(event) => setState((current) => ({ ...current, displayMode: event.target.value as "numbers" | "names" }))}>
              <option value="numbers">Nummern</option>
              <option value="names">Namen (falls vorhanden)</option>
            </select>
          </details>

          <div className="divider" />
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">Schritt 02</p>
              <h2>Zahlen verteilen</h2>
            </div>
          </div>
          <p className="helper-text">Jede {usesNames ? "Person" : "Zahl"} wird höchstens einmal vergeben. Gesperrte Plätze bleiben bei „Neu erzeugen“ erhalten.</p>
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
          <p className="helper-text">Tische ziehen oder mit Pfeiltasten verschieben (Shift = große Schritte, R = drehen). Zwei Plätze anklicken zum Tauschen; mit Schloss fixieren.</p>

          <div className="sidebar-footer">
            <p className="eyebrow">Sicherung</p>
            <div className="edit-actions">
              <button className="mini-button" onClick={savePlan}>Plan speichern</button>
              <button className="mini-button" onClick={loadPlan}>Plan laden</button>
              <button className="mini-button" onClick={downloadBackup}>Backup exportieren</button>
              <button className="mini-button" onClick={() => restoreInputRef.current?.click()}>Backup importieren</button>
              <input ref={restoreInputRef} className="sr-only" type="file" accept="application/json" onChange={(event) => restoreBackup(event.target.files?.[0])} />
            </div>
          </div>
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
          <div ref={stageRef} className="stage" onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} aria-label="Sitzplan-Arbeitsfläche">
            <div className="room-label">RÜCKWAND</div>
            <div className="teacher-desk">LEHRERPULT</div>
            {state.tables.map((table) => {
              const selected = selectedTableId === table.id;
              const tableStyle = { left: `${table.x * 100}%`, top: `${table.y * 100}%`, transform: `translate(-50%, -50%) rotate(${table.rotation}deg)` } as CSSProperties;
              return (
                <div key={table.id} tabIndex={0} role="group" aria-label={`${table.id}, ${tableCapacity(table.type)} Plätze`} className={`table-cluster ${table.type} ${selected ? "selected" : ""}`} style={tableStyle} onPointerDown={(event) => startDrag(event, table)} onKeyDown={(event) => moveSelectedTable(event, table)}>
                  <div className="table-caption">{table.id}</div>
                  <div className="table-body"><span className="table-label">{table.type === "double" ? "DOPPELTISCH" : "EINZELTISCH"}</span></div>
                  <div className="seat-row">
                    {(seatsByTable.get(table.id) ?? []).map((seat) => (
                      <button key={seat.id} className={`seat ${seat.assigned === null ? "empty" : ""} ${selectedSeatId === seat.id ? "seat-selected" : ""} ${seat.locked ? "seat-locked" : ""}`} title={`Platz ${seat.id}: ${studentLabel(seat.assigned)}${seat.locked ? ", gesperrt" : ""}. Klick: tauschen; Doppelklick: sperren.`} aria-label={`Platz ${seat.id}: ${studentLabel(seat.assigned)}${seat.locked ? ", gesperrt" : ""}`} onClick={() => clickSeat(seat)} onDoubleClick={() => toggleSeatLock(seat)}>
                        <span className="seat-id">P{seat.id}</span>
                        <span className={`seat-number ${usesNames ? "seat-name" : ""}`}>{studentLabel(seat.assigned)}</span>
                        {seat.locked && <span className="lock-mark" aria-hidden="true">🔒</span>}
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
            <span><i className="legend-dot locked-dot" /> gesperrt</span>
          </div>
          <p className="sr-only" aria-live="polite">{announcement}</p>
        </section>
      </div>
    </main>
  );
}
