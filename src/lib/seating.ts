import type { Seat, SeatPosition, Student } from "@/types/seating";

export const DEFAULT_ROWS = 4;
export const DEFAULT_COLUMNS = 4;

export function makeSeatKey(
  row: number,
  column: number,
  position: SeatPosition,
) {
  return `${row}-${column}-${position}`;
}

export function seatKey(seat: Pick<Seat, "row" | "column" | "position">) {
  return makeSeatKey(seat.row, seat.column, seat.position);
}

export function normalizeDimension(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}

export function isPositiveDimension(value: number) {
  return Number.isFinite(value) && Math.floor(value) === value && value > 0;
}

export function generateSeats(rows: number, columns: number): Seat[] {
  const safeRows = normalizeDimension(rows);
  const safeColumns = normalizeDimension(columns);
  const seats: Seat[] = [];

  for (let row = 1; row <= safeRows; row += 1) {
    for (let column = 1; column <= safeColumns; column += 1) {
      seats.push({ row, column, position: "left", studentId: null });
      seats.push({ row, column, position: "right", studentId: null });
    }
  }

  return seats;
}

export function parseStudentNames(input: string) {
  return input
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
}

export function createStudentId(name: string, index: number) {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 32) || "student";
  const randomPart =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

  return `${slug}-${index + 1}-${randomPart}`;
}

export function createStudents(names: string[]): Student[] {
  return names.map((name, index) => ({
    id: createStudentId(name, index),
    name,
    gender: "neutral",
  }));
}

export function placeStudents(students: Student[], rows: number, columns: number) {
  const seats = generateSeats(rows, columns);
  const capacity = seats.length;

  return {
    seats: seats.map((seat, index) => ({
      ...seat,
      studentId: students[index]?.id ?? null,
    })),
    unassignedIds: students.slice(capacity).map((student) => student.id),
  };
}

export function reconcileSeats(
  existingSeats: Seat[],
  rows: number,
  columns: number,
) {
  const nextSeats = generateSeats(rows, columns);
  const nextSeatKeys = new Set(nextSeats.map(seatKey));
  const existingByKey = new Map(
    existingSeats.map((seat) => [seatKey(seat), seat]),
  );
  const displacedStudentIds = existingSeats
    .filter((seat) => seat.studentId && !nextSeatKeys.has(seatKey(seat)))
    .map((seat) => seat.studentId as string);

  return {
    seats: nextSeats.map((seat) => ({
      ...seat,
      studentId: existingByKey.get(seatKey(seat))?.studentId ?? null,
    })),
    displacedStudentIds,
  };
}

export function withoutId(ids: string[], id: string) {
  return ids.filter((existingId) => existingId !== id);
}

export function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids));
}

export function shuffleIds(ids: string[]) {
  const copy = [...ids];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy;
}
