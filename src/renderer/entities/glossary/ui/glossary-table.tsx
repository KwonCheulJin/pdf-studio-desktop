import { useState } from "react";
import { X } from "lucide-react";
import {
  MAX_GLOSSARY_TERM_CHARS,
  MAX_GLOSSARY_TERMS,
  type GlossaryTerm
} from "@/renderer/shared/api/bindings";
import { cn } from "@/renderer/shared/lib/utils";
import { GLOSSARY_TEXT, glossaryText } from "../config/glossary-text";
import {
  createGlossaryRow,
  findIgnoredRowIds,
  type GlossaryRow
} from "../model/glossary";

const REMOVE_ICON_SIZE = 14;

const CELL_INPUT_CLASS =
  "focus-visible:ring-ring placeholder:text-muted-foreground h-7 min-w-0 rounded-xs bg-transparent px-1.5 focus-visible:ring-2 focus-visible:outline-none";

interface GlossaryTableProps {
  rows: readonly GlossaryRow[];
  onRowsChange: (rows: GlossaryRow[]) => void;
}

interface RowChange {
  id: string;
  field: keyof GlossaryTerm;
  value: string;
}

/**
 * 용어 표(시안 10 옵션 화면 용어집, 시안 14 공용 용어집 편집이 함께 쓴다).
 * 행은 원어 → 번역어 + ✕, 끝에 "+ 용어 추가". 용어 수·글자 수 상한은 바인딩 상수로 막는다.
 */
export function GlossaryTable({ rows, onRowsChange }: GlossaryTableProps) {
  // 방금 추가한 행의 원어 칸에 바로 쓸 수 있게 한다.
  const [addedRowId, setAddedRowId] = useState<string | null>(null);
  const ignoredRowIds = findIgnoredRowIds(rows);
  const isFull = rows.length >= MAX_GLOSSARY_TERMS;

  const handleChange = ({ id, field, value }: RowChange) => {
    onRowsChange(
      rows.map((row) => (row.id === id ? { ...row, [field]: value } : row))
    );
  };

  const handleRemove = (id: string) => {
    onRowsChange(rows.filter((row) => row.id !== id));
  };

  const handleAdd = () => {
    const row = createGlossaryRow();
    setAddedRowId(row.id);
    onRowsChange([...rows, row]);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="border-border overflow-hidden rounded-md border text-[13px]">
        {rows.map((row, index) => {
          const isIgnored = ignoredRowIds.has(row.id);
          return (
            <div
              key={row.id}
              className={cn(
                "border-border grid grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)_28px] items-center gap-2 border-b px-2.5 py-1.5",
                isIgnored && "text-muted-foreground"
              )}
            >
              <input
                value={row.source}
                onChange={(event) =>
                  handleChange({
                    id: row.id,
                    field: "source",
                    value: event.target.value
                  })
                }
                aria-label={glossaryText.sourceLabel(index + 1)}
                aria-invalid={isIgnored}
                placeholder={GLOSSARY_TEXT.SOURCE}
                maxLength={MAX_GLOSSARY_TERM_CHARS}
                autoFocus={row.id === addedRowId}
                className={CELL_INPUT_CLASS}
              />
              <span className="text-muted-foreground" aria-hidden="true">
                →
              </span>
              <input
                value={row.target}
                onChange={(event) =>
                  handleChange({
                    id: row.id,
                    field: "target",
                    value: event.target.value
                  })
                }
                aria-label={glossaryText.targetLabel(index + 1)}
                aria-invalid={isIgnored}
                placeholder={GLOSSARY_TEXT.TARGET}
                maxLength={MAX_GLOSSARY_TERM_CHARS}
                className={CELL_INPUT_CLASS}
              />
              <button
                type="button"
                aria-label={GLOSSARY_TEXT.REMOVE}
                onClick={() => handleRemove(row.id)}
                className="text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring flex size-6 items-center justify-center rounded-xs focus-visible:ring-2 focus-visible:outline-none"
              >
                <X size={REMOVE_ICON_SIZE} aria-hidden="true" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={handleAdd}
          disabled={isFull}
          className="bg-card-inset text-accent-foreground focus-visible:ring-ring h-8 w-full focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset disabled:opacity-50"
        >
          {GLOSSARY_TEXT.ADD}
        </button>
      </div>
      {ignoredRowIds.size > 0 && (
        <p className="text-destructive text-xs/4.25">
          {GLOSSARY_TEXT.IGNORED_NOTE}
        </p>
      )}
    </div>
  );
}
