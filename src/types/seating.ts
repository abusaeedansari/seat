export type StudentGender = "boy" | "girl" | "neutral";

export type SeatPosition = "left" | "right";

export type SeatingMode = "classroom" | "exam";

export type ExamDifficulty = "easy" | "hard";

export interface Student {
  id: string;
  name: string;
  gender: StudentGender;
  grade?: string;
  division?: string;
  rollNumber?: number;
}

export interface Seat {
  row: number;
  column: number;
  position: SeatPosition;
  studentId: string | null;
}

export interface ExamGroup {
  id: string;
  grade: string;
  division: string;
  startRoll: number;
  endRoll: number;
}

export interface SeatingSaveFile {
  app: "classroom-seating-arrangement";
  version: 1;
  exportedAt: string;
  mode?: SeatingMode;
  examDifficulty?: ExamDifficulty;
  chartTitle?: string;
  roomNumber?: string;
  gradeLabel?: string;
  examGroups?: ExamGroup[];
  rows: number;
  columns: number;
  students: Student[];
  seats: Seat[];
  unassignedIds: string[];
  showGenderColors: boolean;
}
