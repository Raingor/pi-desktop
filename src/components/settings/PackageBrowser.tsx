import { useState, useEffect, useCallback, useRef } from "react";
import { Search, Plus, Check, Loader2, ExternalLink, Sparkles } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useTranslation } from "@/lib/i18n";
import { RECOMMENDED_PACKAGES } from "@/data/recommended-packages";

interface PackageSearchResult {
  name: string;
  description: string;
  version: string;
  downloads: number;
  link: string;
}

type PackageFilter = "all" | "installed" | "available";
type Tab = "recommended" | "search";

interface PackageBrowserProps {
  open: boolean;
  onClose: () => void;
  installed: Set<string>; // ids like "npm:pkg-name"
  onInstall: (id: string) => void;
}

/** One package row with an install / installed control. */
function PackageRow({
  name,
  description,
  link,
  installed,
  onInstall,
}: {
  name: string;
  description: string;
  link?: string;
  installed: boolean;
  onInstall: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="flex items-center gap-3 rounded-lg border px-3 py-2"
      style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card-bg)" }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium" style={{ color: "var(--page-text)" }}>{name}</span>
          <a
            href={link ?? `https://www.npmjs.com/package/${name}`}
            target="_blank"
            rel="noreferrer"
            className="shrink-0"
            style={{ color: "var(--subtle-text)" }}
            title={t("settings.view_on_npm")}
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        {description && (
          <p className="truncate text-xs" style={{ color: "var(--muted-text)" }}>{description}</p>
        )}
      </div>
      {installed ? (
        <span className="flex shrink-0 items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium"
          style={{ borderColor: "color-mix(in srgb, var(--success-text) 45%, transparent)", color: "var(--success-text)" }}>
          <Check className="h-3.5 w-3.5" />
          {t("settings.installed")}
        </span>
      ) : (
        <button
          onClick={onInstall}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-blue-600/50 bg-blue-600/10 px-3 py-1.5 text-xs font-medium text-blue-400 hover:bg-blue-600/20"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("settings.install")}
        </button>
      )}
    </div>
  );
}

/**
 * Package browser modal with two tabs:
 *  - Recommended: the curated list from src/data/recommended-packages.ts
 *  - Search: fuzzy npm-registry search for any pi package
 * Installing writes "npm:<name>" into settings.packages.
 */
export function PackageBrowser({ open, onClose, installed, onInstall }: PackageBrowserProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("recommended");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PackageSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<PackageFilter>("all");
  const debounceRef = useRef<number | undefined>(undefined);

  const runSearch = useCallback((q: string) => {
    setLoading(true);
    fetch(`/api/pi/packages/search?q=${encodeURIComponent(q)}`)
      .then((r) => r.json())
      .then((d: { results?: PackageSearchResult[] }) => setResults(d.results ?? []))
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, []);

  // Load popular packages the first time the Search tab is opened; debounce typing.
  useEffect(() => {
    if (!open || tab !== "search") return;
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => runSearch(query), 350);
    return () => window.clearTimeout(debounceRef.current);
  }, [query, open, tab, runSearch]);

  const isInstalledId = (name: string) => {
    const id = `npm:${name}`;
    return installed.has(id) || justAdded.has(id);
  };

  const handleInstall = (id: string) => {
    onInstall(id);
    setJustAdded((prev) => new Set(prev).add(id));
  };

  // Search-tab results after the installed/available filter.
  const filtered = results.filter((pkg) => {
    if (filter === "installed") return isInstalledId(pkg.name);
    if (filter === "available") return !isInstalledId(pkg.name);
    return true;
  });
  const installedCount = results.filter((p) => isInstalledId(p.name)).length;

  return (
    <Modal open={open} onClose={onClose} title={t("settings.browse_packages")} size="lg">
      <div className="space-y-4">
        {/* Tabs */}
        <div className="flex gap-1 rounded-lg p-1" style={{ backgroundColor: "var(--card-bg)" }}>
          {(["recommended", "search"] as Tab[]).map((tKey) => (
            <button
              key={tKey}
              onClick={() => setTab(tKey)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${tab === tKey ? "bg-blue-600/15 text-blue-400" : "text-gray-400 hover:text-gray-200"}`}
            >
              {tKey === "recommended" ? <Sparkles className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}
              {t(`settings.tab_${tKey}`)}
            </button>
          ))}
        </div>

        {tab === "recommended" ? (
          <div className="max-h-[55vh] space-y-1.5 overflow-y-auto">
            {RECOMMENDED_PACKAGES.map((pkg) => (
              <PackageRow
                key={pkg.id}
                name={pkg.name}
                description={t(pkg.descKey)}
                installed={installed.has(pkg.id) || justAdded.has(pkg.id)}
                onInstall={() => handleInstall(pkg.id)}
              />
            ))}
          </div>
        ) : (
          <>
            {/* Search box */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--subtle-text)" }} />
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("settings.search_packages_placeholder")}
                className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--card-border)", color: "var(--page-text)" }}
              />
            </div>

            {/* Installed / available filter */}
            <div className="flex gap-1 rounded-lg p-1" style={{ backgroundColor: "var(--card-bg)" }}>
              {(["all", "available", "installed"] as PackageFilter[]).map((f) => {
                const count = f === "all" ? results.length : f === "installed" ? installedCount : results.length - installedCount;
                return (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${filter === f ? "bg-blue-600/15 text-blue-400" : "text-gray-400 hover:text-gray-200"}`}
                  >
                    {t(`settings.filter_${f}`)} ({count})
                  </button>
                );
              })}
            </div>

            {/* Results */}
            <div className="max-h-[42vh] space-y-1.5 overflow-y-auto">
              {loading && results.length === 0 ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--muted-text)" }} />
                </div>
              ) : filtered.length === 0 ? (
                <p className="py-10 text-center text-sm" style={{ color: "var(--muted-text)" }}>
                  {t("settings.no_packages_found")}
                </p>
              ) : (
                filtered.map((pkg) => (
                  <PackageRow
                    key={pkg.name}
                    name={pkg.name}
                    description={pkg.description}
                    link={pkg.link}
                    installed={isInstalledId(pkg.name)}
                    onInstall={() => handleInstall(`npm:${pkg.name}`)}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
