"use client";

import { useMemo, useRef, useState } from "react";
import {
  Download,
  Eye,
  EyeOff,
  FileDown,
  FileUp,
  Maximize2,
  Minimize2,
  Pencil,
  RefreshCcw,
  Shuffle,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { SeatEditorDialog } from "@/components/SeatEditorDialog";
import { cn } from "@/lib/classNames";
import {
  DEFAULT_COLUMNS,
  DEFAULT_ROWS,
  generateSeats,
  isPositiveDimension,
  parseStudentNames,
  placeStudents,
  reconcileSeats,
  seatKey,
  shuffleIds,
  uniqueIds,
  withoutId,
} from "@/lib/seating";
import type {
  Seat,
  ExamGroup,
  ExamDifficulty,
  SeatingSaveFile,
  SeatingMode,
  SeatPosition,
  Student,
  StudentGender,
} from "@/types/seating";

type StudentTone = { app: string; export: string };

const genderStyle: Record<StudentGender, StudentTone> = {
  boy: {
    app: "border-sky-200 bg-[#d8ecfb] text-slate-900",
    export: "#cfe4f6",
  },
  girl: {
    app: "border-rose-200 bg-[#f8d7df] text-slate-900",
    export: "#dbeed6",
  },
  neutral: {
    app: "border-slate-200 bg-white text-slate-900",
    export: "#f8fafc",
  },
};

const examGradePalette: StudentTone[] = [
  { app: "border-emerald-200 bg-[#dcf5e8] text-slate-900", export: "#dcf5e8" },
  { app: "border-sky-200 bg-[#dceffc] text-slate-900", export: "#dceffc" },
  { app: "border-violet-200 bg-[#ece7fb] text-slate-900", export: "#ece7fb" },
  { app: "border-amber-200 bg-[#fff1cc] text-slate-900", export: "#fff1cc" },
  { app: "border-rose-200 bg-[#fde2e8] text-slate-900", export: "#fde2e8" },
  { app: "border-teal-200 bg-[#dff5f2] text-slate-900", export: "#dff5f2" },
  { app: "border-lime-200 bg-[#edf8d7] text-slate-900", export: "#edf8d7" },
  { app: "border-orange-200 bg-[#ffe8d6] text-slate-900", export: "#ffe8d6" },
];

function isStudentGender(value: unknown): value is StudentGender {
  return value === "boy" || value === "girl" || value === "neutral";
}

function seatLabel(seat: Seat) {
  return `Row ${seat.column}, seat ${seat.row}${seat.position === "left" ? "A" : "B"}`;
}

function makeStudentId(name: string, index: number) {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 28) || "student";

  return `${slug}-${index + 1}-${crypto.randomUUID()}`;
}

function makeExamGroupId() {
  return `exam-group-${crypto.randomUUID()}`;
}

function examStudentLabel(grade: string, division: string, rollNumber: number) {
  const gradeText = grade.trim() || "Grade";
  const divisionText = division.trim();

  return `${gradeText}${divisionText} - Roll ${rollNumber}`;
}

function examGradeKey(student: Student) {
  return (student.grade || student.name.split("-")[0] || student.name)
    .trim()
    .replace(/\s+/g, " ")
    .replace(/(\d+)\s*[a-z]$/i, "$1")
    .trim()
    .toLowerCase();
}

function examColorKey(student: Student) {
  const label = student.grade
    ? `${student.grade.trim()} ${student.division?.trim() ?? ""}`
    : student.name.split("-")[0] || student.name;

  return label.replace(/\s+/g, " ").trim().toLowerCase();
}

function buildExamColorMap(students: Student[]) {
  const colorByKey = new Map<string, StudentTone>();

  students.forEach((student) => {
    const key = examColorKey(student);

    if (!colorByKey.has(key)) {
      colorByKey.set(
        key,
        examGradePalette[colorByKey.size % examGradePalette.length],
      );
    }
  });

  return colorByKey;
}

function sanitizeExamGroup(group: ExamGroup): ExamGroup {
  const startRoll = Math.max(1, Math.floor(Number(group.startRoll) || 1));
  const endRoll = Math.max(startRoll, Math.floor(Number(group.endRoll) || startRoll));

  return {
    ...group,
    grade: group.grade.trim(),
    division: group.division.trim().toUpperCase(),
    startRoll,
    endRoll,
  };
}

function generateExamStudentsFromGroups(groups: ExamGroup[]) {
  const students: Student[] = [];

  groups.map(sanitizeExamGroup).forEach((group) => {
    if (!group.grade) {
      return;
    }

    for (
      let rollNumber = group.startRoll;
      rollNumber <= group.endRoll;
      rollNumber += 1
    ) {
      const name = examStudentLabel(group.grade, group.division, rollNumber);
      students.push({
        id: makeStudentId(name, students.length),
        name,
        gender: "neutral",
        grade: group.grade,
        division: group.division,
        rollNumber,
      });
    }
  });

  return students;
}

function snakeSeatOrderForSide(
  rows: number,
  columns: number,
  position: SeatPosition,
) {
  const order: Seat[] = [];

  for (let column = 1; column <= columns; column += 1) {
    const rowNumbers =
      column % 2 === 1
        ? Array.from({ length: rows }, (_, index) => index + 1)
        : Array.from({ length: rows }, (_, index) => rows - index);

    for (const row of rowNumbers) {
      order.push({ row, column, position, studentId: null });
    }
  }

  return order;
}

function assignGradeSides(students: Student[], sideCapacity: number) {
  const countsByGrade = students.reduce<Record<string, number>>((counts, student) => {
    const key = examGradeKey(student);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const grades = Object.entries(countsByGrade).sort((first, second) => {
    return second[1] - first[1];
  });
  let best = {
    assignment: new Map<string, SeatPosition>(),
    balance: Number.POSITIVE_INFINITY,
    overflow: Number.POSITIVE_INFINITY,
  };

  function search(
    index: number,
    leftTotal: number,
    rightTotal: number,
    assignment: Map<string, SeatPosition>,
  ) {
    if (index === grades.length) {
      const overflow =
        Math.max(0, leftTotal - sideCapacity) +
        Math.max(0, rightTotal - sideCapacity);
      const balance = Math.abs(leftTotal - rightTotal);

      if (
        overflow < best.overflow ||
        (overflow === best.overflow && balance < best.balance)
      ) {
        best = {
          assignment: new Map(assignment),
          balance,
          overflow,
        };
      }

      return;
    }

    const [grade, count] = grades[index];

    assignment.set(grade, "left");
    search(index + 1, leftTotal + count, rightTotal, assignment);
    assignment.set(grade, "right");
    search(index + 1, leftTotal, rightTotal + count, assignment);
    assignment.delete(grade);
  }

  search(0, 0, 0, new Map());

  return best.assignment;
}

function placeExamGroupsForCollection(
  groups: ExamGroup[],
  rows: number,
  columns: number,
) {
  const seats = generateSeats(rows, columns);
  const studentIdBySeatKey = new Map<string, string>();
  const gradeKeyBySeatKey = new Map<string, string>();
  const students: Student[] = [];
  const unassignedIds: string[] = [];
  const occupiedSeatKeys = new Set<string>();

  function oppositeSeatKey(seat: Seat) {
    return seatKey({
      ...seat,
      position: seat.position === "left" ? "right" : "left",
    });
  }

  function seatsForPosition(position: SeatPosition, gradeKey: string) {
    const availableSeats: Seat[] = [];

    for (let column = 1; column <= columns; column += 1) {
      const rowNumbers =
        column % 2 === 1
          ? Array.from({ length: rows }, (_, index) => index + 1)
          : Array.from({ length: rows }, (_, index) => rows - index);

      for (const row of rowNumbers) {
        const seat: Seat = { row, column, position, studentId: null };
        const key = seatKey(seat);

        if (
          !occupiedSeatKeys.has(key) &&
          gradeKeyBySeatKey.get(oppositeSeatKey(seat)) !== gradeKey
        ) {
          availableSeats.push(seat);
        }
      }
    }

    return availableSeats;
  }

  function chooseSeats(studentCount: number, gradeKey: string) {
    const sideOptions = (["left", "right"] as SeatPosition[])
      .map((position) => {
        const seats = seatsForPosition(position, gradeKey);

        return {
          position,
          seats,
          capacity: seats.length,
          firstColumn: seats[0]?.column ?? Number.POSITIVE_INFINITY,
          firstRow: seats[0]?.row ?? Number.POSITIVE_INFINITY,
        };
      })
      .filter((option) => option.capacity > 0)
      .sort((first, second) => {
        if (first.firstColumn !== second.firstColumn) {
          return first.firstColumn - second.firstColumn;
        }

        if (first.firstRow !== second.firstRow) {
          return first.firstRow - second.firstRow;
        }

        if (first.capacity !== second.capacity) {
          return second.capacity - first.capacity;
        }

        return first.position === "left" ? -1 : 1;
      });

    const fullFit = sideOptions.find((option) => option.capacity >= studentCount);
    const selectedSeats = fullFit?.seats ?? sideOptions[0]?.seats ?? [];

    return selectedSeats.slice(0, studentCount);
  }

  groups.map(sanitizeExamGroup).forEach((group) => {
    if (!group.grade) {
      return;
    }

    const studentCount = group.endRoll - group.startRoll + 1;
    const groupGradeKey = group.grade.trim().toLowerCase();
    const seatsForGroup = chooseSeats(studentCount, groupGradeKey);
    let groupSeatIndex = 0;

    for (
      let rollNumber = group.startRoll;
      rollNumber <= group.endRoll;
      rollNumber += 1
    ) {
      const name = examStudentLabel(group.grade, group.division, rollNumber);
      const student: Student = {
        id: makeStudentId(name, students.length),
        name,
        gender: "neutral",
        grade: group.grade,
        division: group.division,
        rollNumber,
      };

      students.push(student);

      const targetSeat = seatsForGroup[groupSeatIndex];

      if (!targetSeat) {
        unassignedIds.push(student.id);
        continue;
      }

      studentIdBySeatKey.set(seatKey(targetSeat), student.id);
      gradeKeyBySeatKey.set(seatKey(targetSeat), groupGradeKey);
      occupiedSeatKeys.add(seatKey(targetSeat));
      groupSeatIndex += 1;
    }
  });

  const assignedSeats = seats.map((seat) => ({
    ...seat,
    studentId: studentIdBySeatKey.get(seatKey(seat)) ?? null,
  }));
  const studentsById = new Map(students.map((student) => [student.id, student]));

  return {
    students,
    seats: assignedSeats,
    unassignedIds,
    conflictCount: examConflictCount(
      assignedSeats,
      studentsById,
      rows,
      columns,
      "easy",
    ),
  };
}

function adjacentSeatKeys(seat: Seat, rows: number, columns: number) {
  const keys: string[] = [];
  const horizontalIndex = (seat.column - 1) * 2 + (seat.position === "left" ? 0 : 1);
  const horizontalNeighborIndexes = [horizontalIndex - 1, horizontalIndex + 1];

  horizontalNeighborIndexes.forEach((neighborIndex) => {
    if (neighborIndex < 0 || neighborIndex >= columns * 2) {
      return;
    }

    const neighborColumn = Math.floor(neighborIndex / 2) + 1;
    const neighborPosition: SeatPosition =
      neighborIndex % 2 === 0 ? "left" : "right";
    keys.push(`${seat.row}-${neighborColumn}-${neighborPosition}`);
  });

  if (seat.row > 1) {
    keys.push(`${seat.row - 1}-${seat.column}-${seat.position}`);
  }

  if (seat.row < rows) {
    keys.push(`${seat.row + 1}-${seat.column}-${seat.position}`);
  }

  return keys;
}

function conflictSeatKeysFor(
  seats: Seat[],
  studentsById: Map<string, Student>,
  rows: number,
  columns: number,
  difficulty: ExamDifficulty,
) {
  const conflictKeys = sameGradeNeighborConflictSeatKeys(
    seats,
    studentsById,
    rows,
    columns,
  );

  if (difficulty === "hard") {
    sideAlignmentConflictSeatKeys(seats, studentsById).forEach((key) =>
      conflictKeys.add(key),
    );
  }

  return conflictKeys;
}

function sameGradeNeighborConflictSeatKeys(
  seats: Seat[],
  studentsById: Map<string, Student>,
  _rows: number,
  columns: number,
) {
  const seatByKey = new Map(seats.map((seat) => [seatKey(seat), seat]));
  const conflictKeys = new Set<string>();
  const seenEdges = new Set<string>();

  seats.forEach((seat) => {
    const student = seat.studentId ? studentsById.get(seat.studentId) : null;

    if (!student) {
      return;
    }

    const horizontalIndex =
      (seat.column - 1) * 2 + (seat.position === "left" ? 0 : 1);

    [horizontalIndex - 1, horizontalIndex + 1].forEach((neighborIndex) => {
      if (neighborIndex < 0 || neighborIndex >= columns * 2) {
        return;
      }

      const neighborSeat: Seat = {
        row: seat.row,
        column: Math.floor(neighborIndex / 2) + 1,
        position: neighborIndex % 2 === 0 ? "left" : "right",
        studentId: null,
      };
      const neighborKey = seatKey(neighborSeat);
      const edgeKey = [seatKey(seat), neighborKey].sort().join("|");

      if (seenEdges.has(edgeKey)) {
        return;
      }

      seenEdges.add(edgeKey);
      const actualNeighborSeat = seatByKey.get(neighborKey);
      const neighborStudent = actualNeighborSeat?.studentId
        ? studentsById.get(actualNeighborSeat.studentId)
        : null;

      if (
        neighborStudent &&
        examGradeKey(neighborStudent) === examGradeKey(student)
      ) {
        conflictKeys.add(seatKey(seat));
        conflictKeys.add(neighborKey);
      }
    });
  });

  return conflictKeys;
}

function sideAlignmentConflictSeatKeys(
  seats: Seat[],
  studentsById: Map<string, Student>,
) {
  const seatsByGrade = new Map<
    string,
    { positions: Set<SeatPosition>; seatKeys: string[] }
  >();

  seats.forEach((seat) => {
    const student = seat.studentId ? studentsById.get(seat.studentId) : null;

    if (!student) {
      return;
    }

    const key = examGradeKey(student);
    const gradeSeats =
      seatsByGrade.get(key) ??
      ({ positions: new Set<SeatPosition>(), seatKeys: [] } as {
        positions: Set<SeatPosition>;
        seatKeys: string[];
      });

    gradeSeats.positions.add(seat.position);
    gradeSeats.seatKeys.push(seatKey(seat));
    seatsByGrade.set(key, gradeSeats);
  });

  const conflictKeys = new Set<string>();

  seatsByGrade.forEach((gradeSeats) => {
    if (gradeSeats.positions.size <= 1) {
      return;
    }

    gradeSeats.seatKeys.forEach((key) => conflictKeys.add(key));
  });

  return conflictKeys;
}

function examConflictCount(
  seats: Seat[],
  studentsById: Map<string, Student>,
  rows: number,
  columns: number,
  difficulty: ExamDifficulty,
) {
  return conflictSeatKeysFor(seats, studentsById, rows, columns, difficulty).size;
}

function sameGradeNeighborConflictCount(
  seats: Seat[],
  studentsById: Map<string, Student>,
  rows: number,
  columns: number,
) {
  return sameGradeNeighborConflictSeatKeys(
    seats,
    studentsById,
    rows,
    columns,
  ).size;
}

function chooseExamCandidate(
  remaining: Student[],
  assignedSeats: Seat[],
  targetSeat: Seat,
  studentsById: Map<string, Student>,
  rows: number,
  columns: number,
) {
  const assignedByKey = new Map(
    assignedSeats.map((seat) => [seatKey(seat), seat.studentId]),
  );
  const remainingCounts = remaining.reduce<Record<string, number>>((counts, student) => {
    const key = examGradeKey(student);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const neighborGradeKeys = new Set(
    adjacentSeatKeys(targetSeat, rows, columns)
      .map((key) => assignedByKey.get(key))
      .map((studentId) => (studentId ? studentsById.get(studentId) : null))
      .filter((student): student is Student => Boolean(student))
      .map(examGradeKey),
  );
  const allowed = remaining.filter(
    (student) => !neighborGradeKeys.has(examGradeKey(student)),
  );
  const pool = allowed.length ? allowed : remaining;

  return pool.reduce((best, student) => {
    if (!best) {
      return student;
    }

    const bestCount = remainingCounts[examGradeKey(best)] ?? 0;
    const studentCount = remainingCounts[examGradeKey(student)] ?? 0;

    return studentCount > bestCount ? student : best;
  }, null as Student | null);
}

function placeStudentsForExam(
  students: Student[],
  rows: number,
  columns: number,
) {
  const seats = generateSeats(rows, columns);
  const sideCapacity = rows * columns;
  const studentsById = new Map(students.map((student) => [student.id, student]));
  const sideByGrade = assignGradeSides(students, sideCapacity);
  let assignedSeats: Seat[] = seats.map((seat) => ({ ...seat, studentId: null }));
  const unassignedIds: string[] = [];

  (["left", "right"] as SeatPosition[]).forEach((position) => {
    const order = snakeSeatOrderForSide(rows, columns, position);
    const remaining = students.filter(
      (student) => (sideByGrade.get(examGradeKey(student)) ?? "left") === position,
    );

    order.forEach((targetSeat) => {
      if (!remaining.length) {
        return;
      }

      const candidate = chooseExamCandidate(
        remaining,
        assignedSeats,
        targetSeat,
        studentsById,
        rows,
        columns,
      );

      if (!candidate) {
        return;
      }

      assignedSeats = assignedSeats.map((seat) =>
        seatKey(seat) === seatKey(targetSeat)
          ? { ...seat, studentId: candidate.id }
          : seat,
      );
      remaining.splice(
        remaining.findIndex((student) => student.id === candidate.id),
        1,
      );
    });

    unassignedIds.push(...remaining.map((student) => student.id));
  });

  let bestNeighborConflictCount = sameGradeNeighborConflictCount(
    assignedSeats,
    studentsById,
    rows,
    columns,
  );
  let improved = true;

  while (improved && bestNeighborConflictCount > 0) {
    improved = false;

    for (let firstIndex = 0; firstIndex < assignedSeats.length; firstIndex += 1) {
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < assignedSeats.length;
        secondIndex += 1
      ) {
        if (
          !assignedSeats[firstIndex].studentId ||
          !assignedSeats[secondIndex].studentId ||
          assignedSeats[firstIndex].position !== assignedSeats[secondIndex].position
        ) {
          continue;
        }

        const swapped = assignedSeats.map((seat, index) => {
          if (index === firstIndex) {
            return {
              ...seat,
              studentId: assignedSeats[secondIndex].studentId,
            };
          }

          if (index === secondIndex) {
            return {
              ...seat,
              studentId: assignedSeats[firstIndex].studentId,
            };
          }

          return seat;
        });
        const nextNeighborConflictCount = sameGradeNeighborConflictCount(
          swapped,
          studentsById,
          rows,
          columns,
        );

        if (nextNeighborConflictCount < bestNeighborConflictCount) {
          assignedSeats = swapped;
          bestNeighborConflictCount = nextNeighborConflictCount;
          improved = true;
        }
      }
    }
  }

  return {
    seats: assignedSeats,
    unassignedIds,
    conflictCount: examConflictCount(
      assignedSeats,
      studentsById,
      rows,
      columns,
      "hard",
    ),
  };
}

function fillTextFit(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  maxSize: number,
  minSize: number,
  weight = 500,
) {
  let size = maxSize;

  while (size > minSize) {
    context.font = `${weight} ${size}px Arial, sans-serif`;
    if (context.measureText(text).width <= maxWidth) {
      break;
    }
    size -= 1;
  }

  let output = text;
  while (context.measureText(output).width > maxWidth && output.length > 4) {
    output = `${output.slice(0, -2)}...`;
  }

  context.fillText(output, x, y);
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(
    x + width,
    y + height,
    x + width - safeRadius,
    y + height,
  );
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

interface ChartBoardProps {
  chartTitle: string;
  conflictSeatKeys: Set<string>;
  columns: number;
  dragOverSeatKey: string | null;
  gradeLabel: string;
  isFullscreen?: boolean;
  mode: SeatingMode;
  roomNumber: string;
  rows: number;
  seats: Seat[];
  selectedSwapId: string | null;
  showGenderColors: boolean;
  studentsById: Map<string, Student>;
  swapMode: boolean;
  onDragEnd: () => void;
  onDragStart: (studentId: string) => void;
  onDropOnSeat: (studentId: string, targetSeat: Seat) => void;
  onEditSeat: (seat: Seat) => void;
  onSetDragOverSeatKey: (key: string | null) => void;
  onSelectForSwap: (studentId: string) => void;
}

function ChartBoard({
  chartTitle,
  conflictSeatKeys,
  columns,
  dragOverSeatKey,
  gradeLabel,
  isFullscreen = false,
  mode,
  roomNumber,
  rows,
  seats,
  selectedSwapId,
  showGenderColors,
  studentsById,
  swapMode,
  onDragEnd,
  onDragStart,
  onDropOnSeat,
  onEditSeat,
  onSetDragOverSeatKey,
  onSelectForSwap,
}: ChartBoardProps) {
  const seatMap = useMemo(
    () => new Map(seats.map((seat) => [seatKey(seat), seat])),
    [seats],
  );
  const examColorByKey = useMemo(
    () => buildExamColorMap(Array.from(studentsById.values())),
    [studentsById],
  );
  const rowNumbers = Array.from({ length: Math.max(rows, 0) }, (_, index) => index + 1);
  const columnNumbers = Array.from(
    { length: Math.max(columns, 0) },
    (_, index) => index + 1,
  );
  const gap = columns > 5 ? "gap-2" : "gap-4";

  return (
    <section
      className={cn(
        "flex min-h-0 flex-col rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm",
        isFullscreen ? "h-[calc(100vh-88px)]" : "h-[min(76vh,820px)] min-h-[560px]",
      )}
    >
      <div className="mb-2 flex min-h-7 items-center justify-between gap-3">
        <h2 className="min-w-0 truncate text-lg font-semibold">
          {chartTitle || "Seating Arrangement"}
        </h2>
        {(roomNumber || gradeLabel) && (
          <div className="shrink-0 text-sm font-medium text-slate-600">
            {[gradeLabel, roomNumber ? `Room ${roomNumber}` : ""]
              .filter(Boolean)
              .join(" - ")}
          </div>
        )}
      </div>
      <div className="mb-3 grid grid-cols-[92px_1fr] gap-3">
        <div className="flex h-10 items-center justify-center rounded-sm border border-slate-300 bg-slate-100 text-sm font-medium">
          Gate
        </div>
        <div className="flex h-10 items-center justify-center rounded-sm border border-slate-300 bg-slate-200 text-base font-semibold">
          White Board
        </div>
      </div>

      <div
        className={cn("grid min-h-0 flex-1", gap)}
        style={{
          gridTemplateColumns: `repeat(${Math.max(columns, 1)}, minmax(0, 1fr))`,
        }}
      >
        {columnNumbers.map((column) => (
          <div key={column} className="grid min-h-0 grid-rows-[34px_1fr]">
            <div className="flex items-center justify-center rounded-t-sm border border-slate-900 bg-[#fff1c7] text-base font-semibold">
              Row {column}
            </div>
            <div
              className="grid min-h-0 border-x border-b border-slate-900 bg-white"
              style={{
                gridTemplateRows: `repeat(${Math.max(rows, 1)}, minmax(0, 1fr))`,
              }}
            >
              {rowNumbers.map((row) => (
                <div key={row} className="grid min-h-0 grid-cols-2">
                  {(["left", "right"] as SeatPosition[]).map((position) => {
                    const seat = seatMap.get(`${row}-${column}-${position}`);
                    const student = seat?.studentId
                      ? studentsById.get(seat.studentId) ?? null
                      : null;
                    const currentSeatKey = seat ? seatKey(seat) : "";
                    const isDropTarget = dragOverSeatKey === currentSeatKey;
                    const hasConflict = conflictSeatKeys.has(currentSeatKey);
                    const examTone = student
                      ? examColorByKey.get(examColorKey(student))
                      : null;
                    const colorClass =
                      student && showGenderColors && mode === "exam"
                        ? examTone?.app ?? examGradePalette[0].app
                        : student && showGenderColors
                        ? genderStyle[student.gender].app
                        : student
                          ? "border-slate-300 bg-white text-slate-900"
                          : "border-slate-200 bg-slate-50 text-slate-400";

                    if (!seat) {
                      return null;
                    }

                    return (
                      <div
                        key={position}
                        className={cn(
                          "group relative min-h-0 border-r border-t border-slate-900 last:border-r-0",
                          isDropTarget && "z-10 ring-4 ring-emerald-300",
                          hasConflict && "z-10 ring-4 ring-rose-300",
                        )}
                        onDragEnter={() => onSetDragOverSeatKey(currentSeatKey)}
                        onDragLeave={() => onSetDragOverSeatKey(null)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          const studentId = event.dataTransfer.getData("text/plain");
                          onSetDragOverSeatKey(null);
                          if (studentId) {
                            onDropOnSeat(studentId, seat);
                          }
                        }}
                      >
                        {student ? (
                          <div
                            className={cn(
                              "flex h-full min-h-[34px] cursor-grab select-none items-center px-2 text-[clamp(11px,1vw,16px)] font-medium leading-tight transition active:cursor-grabbing",
                              colorClass,
                              selectedSwapId === student.id &&
                                "bg-amber-200 outline outline-4 outline-amber-300",
                              hasConflict && "outline outline-4 outline-rose-300",
                            )}
                            draggable={!swapMode}
                            title={`${student.name} - double click to edit`}
                            onClick={() => onSelectForSwap(student.id)}
                            onDoubleClick={() => onEditSeat(seat)}
                            onDragEnd={onDragEnd}
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/plain", student.id);
                              onDragStart(student.id);
                            }}
                          >
                            <span className="student-name min-w-0 flex-1">
                              {student.name}
                            </span>
                            <button
                              aria-label={`Edit ${student.name}`}
                              className="ml-1 hidden rounded bg-white/70 p-1 text-slate-600 shadow-sm transition hover:bg-white group-hover:block"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                onEditSeat(seat);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            {isDropTarget && (
                              <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-emerald-500/15 text-xs font-semibold text-emerald-900">
                                Swap
                              </span>
                            )}
                          </div>
                        ) : (
                          <button
                            aria-label={`Add student to ${seatLabel(seat)}`}
                            className={cn(
                              "flex h-full min-h-[34px] w-full items-center justify-center text-lg text-slate-300 transition hover:bg-emerald-50 hover:text-emerald-600",
                              isDropTarget && "bg-emerald-50 text-emerald-700",
                            )}
                            type="button"
                            onClick={() => onEditSeat(seat)}
                            onDragOver={(event) => event.preventDefault()}
                          >
                            +
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Home() {
  const [rows, setRows] = useState(DEFAULT_ROWS);
  const [columns, setColumns] = useState(3);
  const [mode, setMode] = useState<SeatingMode>("classroom");
  const [examDifficulty, setExamDifficulty] = useState<ExamDifficulty>("easy");
  const [chartTitle, setChartTitle] = useState("Classroom Seating Arrangement");
  const [roomNumber, setRoomNumber] = useState("");
  const [gradeLabel, setGradeLabel] = useState("");
  const [studentText, setStudentText] = useState("");
  const [examGroups, setExamGroups] = useState<ExamGroup[]>([
    {
      id: makeExamGroupId(),
      grade: "Grade 3",
      division: "A",
      startRoll: 1,
      endRoll: 12,
    },
    {
      id: makeExamGroupId(),
      grade: "Grade 4",
      division: "A",
      startRoll: 1,
      endRoll: 12,
    },
    {
      id: makeExamGroupId(),
      grade: "Grade 5",
      division: "",
      startRoll: 1,
      endRoll: 6,
    },
    {
      id: makeExamGroupId(),
      grade: "Grade 6",
      division: "",
      startRoll: 1,
      endRoll: 6,
    },
  ]);
  const [students, setStudents] = useState<Student[]>([]);
  const [seats, setSeats] = useState<Seat[]>(generateSeats(DEFAULT_ROWS, 3));
  const [unassignedIds, setUnassignedIds] = useState<string[]>([]);
  const [swapMode, setSwapMode] = useState(false);
  const [selectedSwapId, setSelectedSwapId] = useState<string | null>(null);
  const [showGenderColors, setShowGenderColors] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [draggingStudentId, setDraggingStudentId] = useState<string | null>(null);
  const [dragOverSeatKey, setDragOverSeatKey] = useState<string | null>(null);
  const [notice, setNotice] = useState("Ready");
  const [editingSeatKey, setEditingSeatKey] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingGender, setEditingGender] = useState<StudentGender>("neutral");
  const uploadRef = useRef<HTMLInputElement | null>(null);

  const isValidLayout =
    isPositiveDimension(rows) && isPositiveDimension(columns);
  const capacity = isValidLayout ? rows * columns * 2 : 0;
  const parsedNames = useMemo(() => parseStudentNames(studentText), [studentText]);
  const studentsById = useMemo(
    () => new Map(students.map((student) => [student.id, student])),
    [students],
  );
  const examConflictSeatKeys = useMemo(
    () =>
      mode === "exam"
        ? conflictSeatKeysFor(seats, studentsById, rows, columns, examDifficulty)
        : new Set<string>(),
    [columns, examDifficulty, mode, rows, seats, studentsById],
  );
  const examConflictCountValue = useMemo(
    () =>
      mode === "exam"
        ? examConflictCount(seats, studentsById, rows, columns, examDifficulty)
        : 0,
    [columns, examDifficulty, mode, rows, seats, studentsById],
  );
  const seatedCount = seats.filter((seat) => seat.studentId).length;
  const unassignedStudents = unassignedIds
    .map((id) => studentsById.get(id))
    .filter((student): student is Student => Boolean(student));
  const editingSeat = editingSeatKey
    ? seats.find((seat) => seatKey(seat) === editingSeatKey) ?? null
    : null;

  function applyLayoutChange(nextRows: number, nextColumns: number) {
    const reconciled = reconcileSeats(seats, nextRows, nextColumns);

    setRows(nextRows);
    setColumns(nextColumns);
    setSeats(reconciled.seats);
    setUnassignedIds((ids) =>
      uniqueIds([...ids, ...reconciled.displacedStudentIds]),
    );
    setSelectedSwapId(null);
    setNotice("Layout updated");
  }

  function createSeatingChart() {
    if (!isValidLayout || parsedNames.length === 0) {
      return;
    }

    const nextStudents = parsedNames.map((name, index) => ({
      id: makeStudentId(name, index),
      name,
      gender: "neutral" as const,
    }));
    const placed = placeStudents(nextStudents, rows, columns);

    setMode("classroom");
    if (!chartTitle.trim() || chartTitle === "Examination Seating Arrangement") {
      setChartTitle("Classroom Seating Arrangement");
    }
    setStudents(nextStudents);
    setSeats(placed.seats);
    setUnassignedIds(placed.unassignedIds);
    setSelectedSwapId(null);
    setNotice(
      placed.unassignedIds.length
        ? `${placed.unassignedIds.length} students are unassigned`
        : "Seating chart created",
    );
  }

  function findSeatWithStudent(studentId: string) {
    return seats.find((seat) => seat.studentId === studentId) ?? null;
  }

  function moveStudentToSeat(studentId: string, targetSeat: Seat) {
    const sourceSeat = findSeatWithStudent(studentId);

    if (targetSeat.studentId === studentId) {
      return;
    }

    const targetStudentId = targetSeat.studentId;
    let nextUnassignedIds = withoutId(unassignedIds, studentId);

    const nextSeats = seats.map((seat) => {
      if (seatKey(seat) === seatKey(targetSeat)) {
        return { ...seat, studentId };
      }

      if (sourceSeat && seatKey(seat) === seatKey(sourceSeat)) {
        return { ...seat, studentId: targetStudentId ?? null };
      }

      return seat;
    });

    if (!sourceSeat && targetStudentId) {
      nextUnassignedIds = uniqueIds([...nextUnassignedIds, targetStudentId]);
    }

    setSeats(nextSeats);
    setUnassignedIds(nextUnassignedIds);
    setSelectedSwapId(null);
    setNotice(targetStudentId ? "Students swapped" : "Student moved");
  }

  function moveStudentToUnassigned(studentId: string) {
    const sourceSeat = findSeatWithStudent(studentId);

    if (!sourceSeat) {
      return;
    }

    setSeats((currentSeats) =>
      currentSeats.map((seat) =>
        seat.studentId === studentId ? { ...seat, studentId: null } : seat,
      ),
    );
    setUnassignedIds((ids) => uniqueIds([...withoutId(ids, studentId), studentId]));
    setSelectedSwapId(null);
    setNotice("Moved to unassigned");
  }

  function swapStudents(firstId: string, secondId: string) {
    if (firstId === secondId) {
      return;
    }

    const firstSeat = findSeatWithStudent(firstId);
    const secondSeat = findSeatWithStudent(secondId);
    let nextSeats = seats;
    let nextUnassignedIds = [...unassignedIds];

    if (firstSeat && secondSeat) {
      nextSeats = seats.map((seat) => {
        if (seatKey(seat) === seatKey(firstSeat)) {
          return { ...seat, studentId: secondId };
        }

        if (seatKey(seat) === seatKey(secondSeat)) {
          return { ...seat, studentId: firstId };
        }

        return seat;
      });
    } else if (firstSeat && !secondSeat) {
      nextSeats = seats.map((seat) =>
        seatKey(seat) === seatKey(firstSeat)
          ? { ...seat, studentId: secondId }
          : seat,
      );
      nextUnassignedIds = uniqueIds([
        ...withoutId(nextUnassignedIds, secondId),
        firstId,
      ]);
    } else if (!firstSeat && secondSeat) {
      nextSeats = seats.map((seat) =>
        seatKey(seat) === seatKey(secondSeat)
          ? { ...seat, studentId: firstId }
          : seat,
      );
      nextUnassignedIds = uniqueIds([
        ...withoutId(nextUnassignedIds, firstId),
        secondId,
      ]);
    } else {
      const firstIndex = nextUnassignedIds.indexOf(firstId);
      const secondIndex = nextUnassignedIds.indexOf(secondId);

      if (firstIndex >= 0 && secondIndex >= 0) {
        [nextUnassignedIds[firstIndex], nextUnassignedIds[secondIndex]] = [
          nextUnassignedIds[secondIndex],
          nextUnassignedIds[firstIndex],
        ];
      }
    }

    setSeats(nextSeats);
    setUnassignedIds(nextUnassignedIds);
    setNotice("Students swapped");
  }

  function handleSelectForSwap(studentId: string) {
    if (!swapMode) {
      return;
    }

    if (!selectedSwapId) {
      setSelectedSwapId(studentId);
      setNotice("Choose another student");
      return;
    }

    swapStudents(selectedSwapId, studentId);
    setSelectedSwapId(null);
  }

  function handleGenderChange(studentId: string, gender: StudentGender) {
    setStudents((currentStudents) =>
      currentStudents.map((student) =>
        student.id === studentId ? { ...student, gender } : student,
      ),
    );
    setNotice("Gender saved");
  }

  function applyGenderPattern(first: StudentGender, second?: StudentGender) {
    setStudents((currentStudents) =>
      currentStudents.map((student, index) => ({
        ...student,
        gender: second ? (index % 2 === 0 ? first : second) : first,
      })),
    );
    setNotice(second ? "Gender pattern applied" : "Gender updated");
  }

  function createExamSeating() {
    if (!isValidLayout) {
      return;
    }

    const sanitizedGroups = examGroups.map(sanitizeExamGroup);
    const easyPlaced =
      examDifficulty === "easy"
        ? placeExamGroupsForCollection(sanitizedGroups, rows, columns)
        : null;
    const examStudents =
      easyPlaced?.students ?? generateExamStudentsFromGroups(sanitizedGroups);
    const placed = easyPlaced ?? placeStudentsForExam(examStudents, rows, columns);
    const gradeSummary = sanitizedGroups
      .map((group) => group.grade)
      .filter(Boolean)
      .filter((grade, index, grades) => grades.indexOf(grade) === index)
      .join(", ");

    setMode("exam");
    setChartTitle("Examination Seating Arrangement");
    setGradeLabel(gradeSummary);
    setExamGroups(sanitizedGroups);
    setStudents(examStudents);
    setStudentText(examStudents.map((student) => student.name).join("\n"));
    setSeats(placed.seats);
    setUnassignedIds(placed.unassignedIds);
    setSelectedSwapId(null);
    setNotice(
      placed.conflictCount
        ? `${placed.conflictCount} exam seats need review`
        : placed.unassignedIds.length
          ? `${placed.unassignedIds.length} exam seats overflow`
          : `${examDifficulty === "easy" ? "Easy" : "Hard"} exam seating created`,
    );
  }

  function openSeatEditor(seat: Seat) {
    const student = seat.studentId ? studentsById.get(seat.studentId) : null;

    setEditingSeatKey(seatKey(seat));
    setEditingName(student?.name ?? "");
    setEditingGender(student?.gender ?? "neutral");
  }

  function closeSeatEditor() {
    setEditingSeatKey(null);
    setEditingName("");
    setEditingGender("neutral");
  }

  function saveEditedSeat() {
    if (!editingSeat) {
      return;
    }

    const name = editingName.trim();

    if (!name) {
      return;
    }

    if (editingSeat.studentId) {
      const nextStudents = students.map((student) =>
        student.id === editingSeat.studentId
          ? { ...student, name, gender: editingGender }
          : student,
      );

      setStudents(nextStudents);
      setStudentText(nextStudents.map((student) => student.name).join("\n"));
      setNotice("Student updated");
      closeSeatEditor();
      return;
    }

    const newStudent = {
      id: `manual-${crypto.randomUUID()}`,
      name,
      gender: editingGender,
    };
    const nextStudents = [...students, newStudent];

    setStudents(nextStudents);
    setStudentText(nextStudents.map((student) => student.name).join("\n"));
    setSeats((currentSeats) =>
      currentSeats.map((seat) =>
        seatKey(seat) === editingSeatKey
          ? { ...seat, studentId: newStudent.id }
          : seat,
      ),
    );
    setNotice("Student added");
    closeSeatEditor();
  }

  function moveEditingSeatToUnassigned() {
    if (!editingSeat?.studentId) {
      closeSeatEditor();
      return;
    }

    moveStudentToUnassigned(editingSeat.studentId);
    closeSeatEditor();
  }

  function shuffleSeating() {
    if (students.length === 0) {
      return;
    }

    const shuffled = shuffleIds(students.map((student) => student.id));

    setSeats((currentSeats) =>
      currentSeats.map((seat, index) => ({
        ...seat,
        studentId: shuffled[index] ?? null,
      })),
    );
    setUnassignedIds(shuffled.slice(seats.length));
    setSelectedSwapId(null);
    setNotice("Seating shuffled");
  }

  function clearSeating() {
    setSeats((currentSeats) =>
      currentSeats.map((seat) => ({ ...seat, studentId: null })),
    );
    setUnassignedIds(students.map((student) => student.id));
    setSelectedSwapId(null);
    setNotice("All students moved to unassigned");
  }

  function resetApp() {
    setRows(DEFAULT_ROWS);
    setColumns(3);
    setMode("classroom");
    setExamDifficulty("easy");
    setChartTitle("Classroom Seating Arrangement");
    setRoomNumber("");
    setGradeLabel("");
    setExamGroups([
      {
        id: makeExamGroupId(),
        grade: "Grade 3",
        division: "A",
        startRoll: 1,
        endRoll: 12,
      },
      {
        id: makeExamGroupId(),
        grade: "Grade 4",
        division: "A",
        startRoll: 1,
        endRoll: 12,
      },
      {
        id: makeExamGroupId(),
        grade: "Grade 5",
        division: "",
        startRoll: 1,
        endRoll: 6,
      },
      {
        id: makeExamGroupId(),
        grade: "Grade 6",
        division: "",
        startRoll: 1,
        endRoll: 6,
      },
    ]);
    setStudentText("");
    setStudents([]);
    setSeats(generateSeats(DEFAULT_ROWS, 3));
    setUnassignedIds([]);
    setSwapMode(false);
    setSelectedSwapId(null);
    setShowGenderColors(true);
    setNotice("Ready");
  }

  function downloadConfiguration() {
    const saveFile: SeatingSaveFile = {
      app: "classroom-seating-arrangement",
      version: 1,
      exportedAt: new Date().toISOString(),
      mode,
      examDifficulty,
      chartTitle,
      roomNumber,
      gradeLabel,
      examGroups,
      rows,
      columns,
      students,
      seats,
      unassignedIds,
      showGenderColors,
    };
    const blob = new Blob([JSON.stringify(saveFile, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `classroom-seating-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice("JSON downloaded");
  }

  async function restoreConfiguration(file: File | null) {
    if (!file) {
      return;
    }

    try {
      const parsed = JSON.parse(await file.text()) as Partial<SeatingSaveFile>;

      if (
        parsed.app !== "classroom-seating-arrangement" ||
        parsed.version !== 1 ||
        !isPositiveDimension(Number(parsed.rows)) ||
        !isPositiveDimension(Number(parsed.columns)) ||
        !Array.isArray(parsed.students)
      ) {
        throw new Error("Invalid file");
      }

      const restoredRows = Number(parsed.rows);
      const restoredColumns = Number(parsed.columns);
      const restoredStudents = parsed.students.map((student, index) => ({
        id: String(student.id || `student-${index + 1}`),
        name: String(student.name || `Student ${index + 1}`),
        gender: isStudentGender(student.gender) ? student.gender : "neutral",
        grade: student.grade ? String(student.grade) : undefined,
        division: student.division ? String(student.division) : undefined,
        rollNumber: Number.isFinite(Number(student.rollNumber))
          ? Number(student.rollNumber)
          : undefined,
      }));
      const studentIds = new Set(restoredStudents.map((student) => student.id));
      const templateSeats = generateSeats(restoredRows, restoredColumns);
      const uploadedSeats = Array.isArray(parsed.seats) ? parsed.seats : [];
      const uploadedByKey = new Map(
        uploadedSeats.map((seat) => [seatKey(seat), seat]),
      );
      const restoredSeats = templateSeats.map((seat) => {
        const uploaded = uploadedByKey.get(seatKey(seat));
        const studentId =
          uploaded?.studentId && studentIds.has(uploaded.studentId)
            ? uploaded.studentId
            : null;

        return { ...seat, studentId };
      });
      const seatedIds = new Set(
        restoredSeats
          .map((seat) => seat.studentId)
          .filter((id): id is string => Boolean(id)),
      );
      const restoredUnassignedIds = Array.isArray(parsed.unassignedIds)
        ? parsed.unassignedIds.filter(
            (id) => studentIds.has(id) && !seatedIds.has(id),
          )
        : [];
      const missingUnassignedIds = restoredStudents
        .map((student) => student.id)
        .filter(
          (id) => !seatedIds.has(id) && !restoredUnassignedIds.includes(id),
        );

      setRows(restoredRows);
      setColumns(restoredColumns);
      setMode(parsed.mode === "exam" ? "exam" : "classroom");
      setExamDifficulty(parsed.examDifficulty === "hard" ? "hard" : "easy");
      setChartTitle(
        parsed.chartTitle ||
          (parsed.mode === "exam"
            ? "Examination Seating Arrangement"
            : "Classroom Seating Arrangement"),
      );
      setRoomNumber(parsed.roomNumber || "");
      setGradeLabel(parsed.gradeLabel || "");
      if (Array.isArray(parsed.examGroups) && parsed.examGroups.length) {
        setExamGroups(
          parsed.examGroups.map((group) =>
            sanitizeExamGroup({
              id: group.id || makeExamGroupId(),
              grade: group.grade || "",
              division: group.division || "",
              startRoll: Number(group.startRoll) || 1,
              endRoll: Number(group.endRoll) || 1,
            }),
          ),
        );
      }
      setStudents(restoredStudents);
      setSeats(restoredSeats);
      setUnassignedIds(uniqueIds([...restoredUnassignedIds, ...missingUnassignedIds]));
      setStudentText(restoredStudents.map((student) => student.name).join("\n"));
      setShowGenderColors(Boolean(parsed.showGenderColors));
      setNotice(`Restored ${restoredStudents.length} students`);
    } catch {
      setNotice("Could not restore that JSON file");
    }
  }

  function exportPng() {
    const canvas = document.createElement("canvas");
    const width = 1600;
    const height = 900;
    const context = canvas.getContext("2d");

    if (!context) {
      setNotice("PNG export failed");
      return;
    }

    canvas.width = width;
    canvas.height = height;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);

    const margin = 54;
    const boardHeight = 54;
    const gateWidth = 150;
    const gap = Math.max(22, Math.min(44, 80 / Math.max(columns, 1)));
    const titleTop = 30;
    const boardTop = 86;
    const chartTop = 164;
    const countHeight = 34;
    const chartBottom = height - margin - countHeight;
    const usableWidth = width - margin * 2;
    const groupWidth =
      (usableWidth - gap * (Math.max(columns, 1) - 1)) / Math.max(columns, 1);
    const headerHeight = Math.max(28, Math.min(48, 60 - rows * 1.2));
    const rowHeight = (chartBottom - chartTop - headerHeight) / Math.max(rows, 1);
    const baseFont = Math.max(
      9,
      Math.min(18, rowHeight * 0.38, groupWidth / 12),
    );
    const seatMap = new Map(seats.map((seat) => [seatKey(seat), seat]));
    const examColorByKey = buildExamColorMap(students);

    context.fillStyle = "#000000";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "700 30px Arial, sans-serif";
    fillTextFit(
      context,
      chartTitle || "Seating Arrangement",
      width / 2,
      titleTop,
      width - margin * 2,
      30,
      16,
      700,
    );
    const metaLine = [gradeLabel, roomNumber ? `Room ${roomNumber}` : ""]
      .filter(Boolean)
      .join(" - ");
    if (metaLine) {
      context.fillStyle = "#334155";
      context.font = "500 20px Arial, sans-serif";
      context.fillText(metaLine, width / 2, titleTop + 32);
    }

    context.fillStyle = "#f1f5f9";
    context.strokeStyle = "#cbd5e1";
    context.lineWidth = 1;
    roundedRect(context, margin, boardTop, gateWidth, boardHeight, 12);
    context.fill();
    context.stroke();
    context.fillStyle = "#000000";
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.font = "500 20px Arial, sans-serif";
    context.fillText("Gate", margin + 32, boardTop + boardHeight / 2);

    context.fillStyle = "#ffffff";
    context.strokeStyle = "#cbd5e1";
    roundedRect(
      context,
      margin + gateWidth + 20,
      boardTop,
      usableWidth - gateWidth - 20,
      boardHeight,
      12,
    );
    context.fill();
    context.stroke();
    context.fillStyle = "#000000";
    context.textAlign = "center";
    context.font = "700 24px Arial, sans-serif";
    context.fillText(
      "White Board",
      margin + gateWidth + 20 + (usableWidth - gateWidth - 20) / 2,
      boardTop + boardHeight / 2,
    );

    for (let column = 1; column <= columns; column += 1) {
      const groupX = margin + (column - 1) * (groupWidth + gap);
      const groupY = chartTop;

      context.fillStyle = "#fff1c7";
      context.strokeStyle = "#111111";
      context.lineWidth = 2;
      context.fillRect(groupX, groupY, groupWidth, headerHeight);
      context.strokeRect(groupX, groupY, groupWidth, headerHeight);
      context.fillStyle = "#000000";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = `700 ${Math.max(18, headerHeight * 0.42)}px Arial, sans-serif`;
      context.fillText(`Row ${column}`, groupX + groupWidth / 2, groupY + headerHeight / 2);

      for (let row = 1; row <= rows; row += 1) {
        for (const position of ["left", "right"] as SeatPosition[]) {
          const seat = seatMap.get(`${row}-${column}-${position}`);
          const student = seat?.studentId ? studentsById.get(seat.studentId) : null;
          const cellX = groupX + (position === "left" ? 0 : groupWidth / 2);
          const cellY = groupY + headerHeight + (row - 1) * rowHeight;
          const cellW = groupWidth / 2;
          const examTone = student
            ? examColorByKey.get(examColorKey(student))
            : null;

          context.fillStyle =
            student && showGenderColors && mode === "exam"
              ? examTone?.export ?? examGradePalette[0].export
              : student && showGenderColors
              ? genderStyle[student.gender].export
              : student
                ? "#ffffff"
                : "#f8fafc";
          context.strokeStyle = "#111111";
          context.lineWidth = 1;
          context.fillRect(cellX, cellY, cellW, rowHeight);
          context.strokeRect(cellX, cellY, cellW, rowHeight);

          if (student) {
            context.fillStyle = "#000000";
            context.textAlign = "left";
            context.textBaseline = "middle";
            fillTextFit(
              context,
              student.name,
              cellX + Math.max(8, cellW * 0.04),
              cellY + rowHeight / 2,
              cellW - Math.max(16, cellW * 0.08),
              baseFont,
              7,
              500,
            );
          }
        }
      }

      context.fillStyle = "#000000";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = "500 20px Arial, sans-serif";
      context.fillText(String(rows * 2), groupX + groupWidth / 2, chartBottom + countHeight / 2);
    }

    const link = document.createElement("a");
    link.download = `classroom-seating-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    setNotice("PNG exported");
  }

  const chart = (
    <ChartBoard
      chartTitle={chartTitle}
      conflictSeatKeys={examConflictSeatKeys}
      columns={columns}
      dragOverSeatKey={dragOverSeatKey}
      gradeLabel={gradeLabel}
      isFullscreen={isFullscreen}
      mode={mode}
      roomNumber={roomNumber}
      rows={rows}
      seats={seats}
      selectedSwapId={selectedSwapId}
      showGenderColors={showGenderColors}
      studentsById={studentsById}
      swapMode={swapMode}
      onDragEnd={() => {
        setDraggingStudentId(null);
        setDragOverSeatKey(null);
      }}
      onDragStart={(studentId) => {
        setDraggingStudentId(studentId);
        setNotice("Drop on a seat to move or swap");
      }}
      onDropOnSeat={moveStudentToSeat}
      onEditSeat={openSeatEditor}
      onSetDragOverSeatKey={setDragOverSeatKey}
      onSelectForSwap={handleSelectForSwap}
    />
  );

  return (
    <main className="min-h-screen bg-[#f7f7f3] px-4 py-4 text-slate-900">
      <div className="mx-auto grid max-w-[1780px] gap-4 xl:grid-cols-[360px_1fr]">
        <aside className="space-y-3">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold">Seating Arrangement</h1>
                <p className="text-sm text-slate-500">Fast classroom chart maker</p>
              </div>
              <div className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium">
                {notice}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-xl bg-slate-50 p-2">
                <div className="text-lg font-semibold">{students.length}</div>
                <div className="text-slate-500">Students</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-2">
                <div className="text-lg font-semibold">{seatedCount}</div>
                <div className="text-slate-500">Seated</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-2">
                <div className="text-lg font-semibold">{capacity}</div>
                <div className="text-slate-500">Seats</div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
              {(["classroom", "exam"] as SeatingMode[]).map((option) => (
                <button
                  key={option}
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm font-semibold capitalize transition",
                    mode === option
                      ? "bg-white text-slate-950 shadow-sm"
                      : "text-slate-500 hover:text-slate-800",
                  )}
                  type="button"
                  onClick={() => {
                    setMode(option);
                    if (option === "exam") {
                      setChartTitle("Examination Seating Arrangement");
                      setGradeLabel(
                        examGroups
                          .map((group) => group.grade.trim())
                          .filter(Boolean)
                          .filter((grade, index, grades) => grades.indexOf(grade) === index)
                          .join(", "),
                      );
                    } else {
                      setChartTitle("Classroom Seating Arrangement");
                    }
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">
                Export title / class name
              </span>
              <input
                className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                placeholder="Classroom Seating Arrangement"
                value={chartTitle}
                onChange={(event) => setChartTitle(event.target.value)}
              />
            </label>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Grade/Class</span>
                <input
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                  placeholder="Grade 3A"
                  value={gradeLabel}
                  onChange={(event) => setGradeLabel(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Room</span>
                <input
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                  placeholder="204"
                  value={roomNumber}
                  onChange={(event) => setRoomNumber(event.target.value)}
                />
              </label>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Seat pairs</span>
                <input
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                  min={1}
                  type="number"
                  value={Number.isNaN(rows) ? "" : rows}
                  onChange={(event) => applyLayoutChange(Number(event.target.value), columns)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Rows</span>
                <input
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                  min={1}
                  type="number"
                  value={Number.isNaN(columns) ? "" : columns}
                  onChange={(event) => applyLayoutChange(rows, Number(event.target.value))}
                />
              </label>
            </div>
            {!isValidLayout && (
              <p className="mt-2 text-sm font-medium text-rose-700">
                Use positive whole numbers.
              </p>
            )}
          </section>

          {mode === "classroom" && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold">Paste Names</h2>
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-sm font-medium text-amber-900">
                {parsedNames.length}
              </span>
            </div>
            <textarea
              className="h-36 w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm leading-6 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
              placeholder={"One student per line\nAarav\nMaya\nReyansh"}
              value={studentText}
              onChange={(event) => setStudentText(event.target.value)}
            />
            {parsedNames.length > capacity && isValidLayout && (
              <p className="mt-2 text-sm font-medium text-amber-800">
                {parsedNames.length - capacity} will be unassigned.
              </p>
            )}
            <button
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={!isValidLayout || parsedNames.length === 0}
              type="button"
              onClick={createSeatingChart}
            >
              <WandSparkles className="h-4 w-4" />
              Create Chart
            </button>
            </section>
          )}

          {mode === "exam" && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Exam Groups</h2>
                  <p className="text-sm text-slate-500">
                    Add grade/division ranges, then choose the seating strength.
                  </p>
                </div>
                <button
                  className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1.5 text-sm font-semibold transition hover:bg-slate-200"
                  type="button"
                  onClick={() =>
                    setExamGroups((groups) => [
                      ...groups,
                      {
                        id: makeExamGroupId(),
                        grade: "",
                        division: "",
                        startRoll: 1,
                        endRoll: 1,
                      },
                    ])
                  }
                >
                  Add
                </button>
              </div>
              <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
                {(["easy", "hard"] as ExamDifficulty[]).map((option) => (
                  <button
                    key={option}
                    className={cn(
                      "rounded-lg px-3 py-2 text-sm font-semibold capitalize transition",
                      examDifficulty === option
                        ? "bg-white text-slate-950 shadow-sm"
                        : "text-slate-500 hover:text-slate-800",
                    )}
                    type="button"
                    onClick={() => setExamDifficulty(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <div className="grid gap-2">
                <div className="grid grid-cols-[1.1fr_0.7fr_0.65fr_0.65fr_32px] gap-1 px-1 text-[11px] font-semibold uppercase text-slate-500">
                  <span>Grade</span>
                  <span>Div</span>
                  <span>From</span>
                  <span>To</span>
                  <span />
                </div>
                {examGroups.map((group) => (
                  <div
                    key={group.id}
                    className="grid grid-cols-[1.1fr_0.7fr_0.65fr_0.65fr_32px] gap-1"
                  >
                    <input
                      aria-label={`Grade for group ${group.id}`}
                      className="min-w-0 rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                      placeholder="Grade 3"
                      value={group.grade}
                      onChange={(event) =>
                        setExamGroups((groups) =>
                          groups.map((currentGroup) =>
                            currentGroup.id === group.id
                              ? { ...currentGroup, grade: event.target.value }
                              : currentGroup,
                          ),
                        )
                      }
                    />
                    <input
                      aria-label={`Division for group ${group.id}`}
                      className="min-w-0 rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                      placeholder="A"
                      value={group.division}
                      onChange={(event) =>
                        setExamGroups((groups) =>
                          groups.map((currentGroup) =>
                            currentGroup.id === group.id
                              ? { ...currentGroup, division: event.target.value }
                              : currentGroup,
                          ),
                        )
                      }
                    />
                    <input
                      aria-label={`Start roll for group ${group.id}`}
                      className="min-w-0 rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                      min={1}
                      type="number"
                      value={group.startRoll}
                      onChange={(event) =>
                        setExamGroups((groups) =>
                          groups.map((currentGroup) =>
                            currentGroup.id === group.id
                              ? {
                                  ...currentGroup,
                                  startRoll: Number(event.target.value),
                                }
                              : currentGroup,
                          ),
                        )
                      }
                    />
                    <input
                      aria-label={`End roll for group ${group.id}`}
                      className="min-w-0 rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                      min={1}
                      type="number"
                      value={group.endRoll}
                      onChange={(event) =>
                        setExamGroups((groups) =>
                          groups.map((currentGroup) =>
                            currentGroup.id === group.id
                              ? {
                                  ...currentGroup,
                                  endRoll: Number(event.target.value),
                                }
                              : currentGroup,
                          ),
                        )
                      }
                    />
                    <button
                      aria-label={`Remove group ${group.id}`}
                      className="rounded-lg bg-rose-50 text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={examGroups.length === 1}
                      type="button"
                      onClick={() =>
                        setExamGroups((groups) =>
                          groups.filter((currentGroup) => currentGroup.id !== group.id),
                        )
                      }
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Total:{" "}
                <span className="font-semibold text-slate-900">
                  {examGroups.reduce((total, group) => {
                    const sanitized = sanitizeExamGroup(group);
                    return total + (sanitized.grade ? sanitized.endRoll - sanitized.startRoll + 1 : 0);
                  }, 0)}
                </span>{" "}
                students. Capacity:{" "}
                <span className="font-semibold text-slate-900">{capacity}</span>
                {examConflictCountValue > 0 && (
                  <span className="ml-1 font-semibold text-rose-700">
                    {examConflictCountValue} exam seats need review.
                  </span>
                )}
              </div>
              <button
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={!isValidLayout}
                type="button"
                onClick={createExamSeating}
              >
                <WandSparkles className="h-4 w-4" />
                Arrange Exam Seats
              </button>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {examDifficulty === "easy"
                  ? "Easy keeps each grade in one-seat-wide snake lanes for simpler collection."
                  : "Hard keeps each grade family on one side and mixes grades on that side where possible."}
              </p>
            </section>
          )}

          {mode === "classroom" && students.length > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold">Quick Gender Setup</h2>
                <span className="text-sm text-slate-500">Saved in JSON</span>
              </div>
              <div className="mb-3 grid grid-cols-3 gap-2">
                <button
                  className="rounded-lg bg-sky-100 px-2 py-1.5 text-sm font-semibold text-sky-900"
                  type="button"
                  onClick={() => applyGenderPattern("boy", "girl")}
                >
                  B/G
                </button>
                <button
                  className="rounded-lg bg-rose-100 px-2 py-1.5 text-sm font-semibold text-rose-900"
                  type="button"
                  onClick={() => applyGenderPattern("girl", "boy")}
                >
                  G/B
                </button>
                <button
                  className="rounded-lg bg-slate-100 px-2 py-1.5 text-sm font-semibold text-slate-700"
                  type="button"
                  onClick={() => applyGenderPattern("neutral")}
                >
                  Neutral
                </button>
              </div>
              <div className="grid max-h-48 gap-1 overflow-y-auto pr-1">
                {students.map((student) => (
                  <div
                    key={student.id}
                    className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5"
                  >
                    <span className="student-name text-sm font-medium">
                      {student.name}
                    </span>
                    <div className="grid grid-cols-3 gap-1">
                      {(["boy", "girl", "neutral"] as StudentGender[]).map(
                        (gender) => (
                          <button
                            key={gender}
                            className={cn(
                              "h-7 w-8 rounded-md text-xs font-semibold transition",
                              student.gender === gender
                                ? gender === "boy"
                                  ? "bg-sky-300 text-sky-950"
                                  : gender === "girl"
                                    ? "bg-rose-300 text-rose-950"
                                    : "bg-white text-slate-900 shadow-sm"
                                : "bg-white text-slate-400 hover:text-slate-800",
                            )}
                            type="button"
                            onClick={() => handleGenderChange(student.id, gender)}
                          >
                            {gender === "boy" ? "B" : gender === "girl" ? "G" : "N"}
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid grid-cols-2 gap-2">
              <button
                className={cn(
                  "rounded-xl px-3 py-2 text-sm font-semibold transition",
                  swapMode
                    ? "bg-amber-300 text-amber-950"
                    : "bg-slate-100 hover:bg-slate-200",
                )}
                type="button"
                onClick={() => {
                  setSwapMode((enabled) => !enabled);
                  setSelectedSwapId(null);
                  setNotice(swapMode ? "Swap mode off" : "Click two students to swap");
                }}
              >
                Swap Mode
              </button>
              <button
                className="flex items-center justify-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold transition hover:bg-slate-200"
                type="button"
                onClick={() => setShowGenderColors((show) => !show)}
              >
                {showGenderColors ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                Colors
              </button>
              {mode === "classroom" && (
                <button
                  className="flex items-center justify-center gap-2 rounded-xl bg-sky-100 px-3 py-2 text-sm font-semibold transition hover:bg-sky-200 disabled:opacity-50"
                  disabled={students.length === 0}
                  type="button"
                  onClick={shuffleSeating}
                >
                  <Shuffle className="h-4 w-4" />
                  Shuffle
                </button>
              )}
              <button
                className="flex items-center justify-center gap-2 rounded-xl bg-rose-100 px-3 py-2 text-sm font-semibold text-rose-800 transition hover:bg-rose-200 disabled:opacity-50"
                disabled={students.length === 0}
                type="button"
                onClick={clearSeating}
              >
                <Trash2 className="h-4 w-4" />
                Clear
              </button>
              <button
                className="flex items-center justify-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold transition hover:bg-slate-200"
                type="button"
                onClick={resetApp}
              >
                <RefreshCcw className="h-4 w-4" />
                Reset
              </button>
              <button
                className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
                type="button"
                onClick={() => setIsFullscreen(true)}
              >
                <Maximize2 className="h-4 w-4" />
                Fit View
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-2">
              <button
                className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 font-semibold text-white transition hover:bg-slate-700"
                type="button"
                onClick={exportPng}
              >
                <Download className="h-4 w-4" />
                Export PNG
              </button>
              <button
                className="flex items-center justify-center gap-2 rounded-xl bg-emerald-100 px-4 py-2.5 font-semibold text-emerald-900 transition hover:bg-emerald-200"
                type="button"
                onClick={downloadConfiguration}
              >
                <FileDown className="h-4 w-4" />
                Download JSON
              </button>
              <button
                className="flex items-center justify-center gap-2 rounded-xl bg-violet-100 px-4 py-2.5 font-semibold text-violet-900 transition hover:bg-violet-200"
                type="button"
                onClick={() => uploadRef.current?.click()}
              >
                <FileUp className="h-4 w-4" />
                Upload JSON
              </button>
              <input
                ref={uploadRef}
                accept="application/json,.json"
                className="hidden"
                type="file"
                onChange={(event) => {
                  void restoreConfiguration(event.target.files?.[0] ?? null);
                  event.target.value = "";
                }}
              />
            </div>
          </section>

          <section
            className={cn(
              "rounded-2xl border border-dashed bg-white p-3 shadow-sm transition",
              draggingStudentId ? "border-emerald-400 bg-emerald-50" : "border-slate-200",
            )}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const studentId = event.dataTransfer.getData("text/plain");
              if (studentId) {
                moveStudentToUnassigned(studentId);
              }
            }}
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold">Unassigned</h2>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-sm font-medium">
                {unassignedStudents.length}
              </span>
            </div>
            <div className="grid max-h-36 gap-1 overflow-y-auto">
              {unassignedStudents.length ? (
                unassignedStudents.map((student) => (
                  <div
                    key={student.id}
                    className={cn(
                      "cursor-grab rounded-lg border px-2 py-1.5 text-sm font-medium",
                      showGenderColors
                        ? genderStyle[student.gender].app
                        : "border-slate-200 bg-white",
                    )}
                    draggable={!swapMode}
                    onClick={() => handleSelectForSwap(student.id)}
                    onDragEnd={() => setDraggingStudentId(null)}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", student.id);
                      setDraggingStudentId(student.id);
                      setNotice("Drop on a seat to place");
                    }}
                  >
                    {student.name}
                  </div>
                ))
              ) : (
                <p className="py-3 text-center text-sm text-slate-400">None</p>
              )}
            </div>
          </section>
        </aside>

        <div className="min-w-0">{chart}</div>
      </div>

      {isFullscreen && (
        <div className="fixed inset-0 z-40 bg-[#f7f7f3] p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium text-slate-600">
              {seatedCount}/{capacity} seated
              {draggingStudentId ? " - drop to move or swap" : ""}
            </div>
            <button
              className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              type="button"
              onClick={() => setIsFullscreen(false)}
            >
              <Minimize2 className="h-4 w-4" />
              Exit Fit View
            </button>
          </div>
          {chart}
        </div>
      )}

      {editingSeat && (
        <SeatEditorDialog
          gender={editingGender}
          hasStudent={Boolean(editingSeat.studentId)}
          mode={mode}
          name={editingName}
          seat={editingSeat}
          onClose={closeSeatEditor}
          onGenderChange={setEditingGender}
          onMoveToUnassigned={moveEditingSeatToUnassigned}
          onNameChange={setEditingName}
          onSave={saveEditedSeat}
        />
      )}
    </main>
  );
}
