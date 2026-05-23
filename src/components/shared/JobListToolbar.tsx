import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

type FilterChip = { id: string; label: string };

type Props = {
  search: string;
  onSearch: (value: string) => void;
  placeholder?: string;
  filters?: FilterChip[];
  activeFilter?: string;
  onFilter?: (id: string) => void;
  count?: number;
  total?: number;
  countLabel?: string;
};

export function JobListToolbar({
  search,
  onSearch,
  placeholder = "Search…",
  filters,
  activeFilter = "",
  onFilter,
  count,
  total,
  countLabel = "jobs",
}: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-600" />
          <input
            type="search"
            placeholder={placeholder}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            className="w-full rounded-md border border-stone-700 bg-stone-900 py-2 pl-9 pr-3 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brand-500 focus:outline-none"
          />
        </div>
        {count !== undefined && total !== undefined && (
          <span className="text-xs text-stone-500">
            {count} of {total} {countLabel}
          </span>
        )}
      </div>
      {filters && filters.length > 0 && onFilter && (
        <div className="flex flex-wrap gap-2">
          {filters.map(({ id, label }) => (
            <button
              key={id || "all"}
              type="button"
              onClick={() => onFilter(id)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs",
                activeFilter === id
                  ? "bg-stone-800 text-stone-100"
                  : "text-stone-500 hover:text-stone-300",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
