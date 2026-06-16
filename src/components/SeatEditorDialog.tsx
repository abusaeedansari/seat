"use client";

import { X } from "lucide-react";
import type { Seat, SeatingMode, StudentGender } from "@/types/seating";
import { cn } from "@/lib/classNames";

interface SeatEditorDialogProps {
  seat: Seat;
  name: string;
  gender: StudentGender;
  hasStudent: boolean;
  mode: SeatingMode;
  onNameChange: (name: string) => void;
  onGenderChange: (gender: StudentGender) => void;
  onSave: () => void;
  onMoveToUnassigned: () => void;
  onClose: () => void;
}

const genderOptions: Array<{ label: string; value: StudentGender }> = [
  { label: "Boy", value: "boy" },
  { label: "Girl", value: "girl" },
  { label: "Neutral", value: "neutral" },
];

export function SeatEditorDialog({
  seat,
  name,
  gender,
  hasStudent,
  mode,
  onNameChange,
  onGenderChange,
  onSave,
  onMoveToUnassigned,
  onClose,
}: SeatEditorDialogProps) {
  const isExamMode = mode === "exam";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-white bg-white p-5 shadow-soft">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-500">
              Row {seat.column}, seat {seat.row}
              {seat.position === "left" ? "A" : "B"}
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-ink">
              {hasStudent
                ? isExamMode
                  ? "Edit exam seat"
                  : "Edit student"
                : isExamMode
                  ? "Add exam seat"
                  : "Add student"}
            </h2>
          </div>
          <button
            aria-label="Close editor"
            className="rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200"
            type="button"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">
            {isExamMode ? "Student / roll label" : "Student name"}
          </span>
          <input
            autoFocus
            className="w-full rounded-2xl border border-slate-200 bg-chalk px-4 py-3 text-base outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
            placeholder={isExamMode ? "Grade 4A - Roll 1" : "Type a student name"}
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onSave();
              }
            }}
          />
        </label>

        {!isExamMode && (
          <div className="mt-4">
            <p className="mb-2 text-sm font-semibold text-slate-700">Gender color</p>
            <div className="grid grid-cols-3 gap-2 rounded-2xl bg-slate-100 p-1.5">
              {genderOptions.map((option) => (
                <button
                  key={option.value}
                  className={cn(
                    "rounded-xl px-3 py-2 text-sm font-medium transition",
                    gender === option.value
                      ? "bg-white text-ink shadow-sm"
                      : "text-slate-500 hover:text-slate-800",
                  )}
                  type="button"
                  onClick={() => onGenderChange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          {hasStudent && (
            <button
              className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
              type="button"
              onClick={onMoveToUnassigned}
            >
              Move to unassigned
            </button>
          )}
          <button
            className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-700/20 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
            disabled={!name.trim()}
            type="button"
            onClick={onSave}
          >
            Save seat
          </button>
        </div>
      </div>
    </div>
  );
}
