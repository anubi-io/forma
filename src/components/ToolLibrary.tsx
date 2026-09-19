import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowSquareOut,
  ArrowUp,
  CaretDown,
  CaretRight,
  Check,
  Cylinder,
  MagnifyingGlass,
  Warning,
  X,
} from "@phosphor-icons/react";
import catalog from "../data/makera.json";
import {
  compareTools,
  matchesToolGroup,
  matchesToolSearch,
  toolCategory,
  TOOL_FAMILIES,
  type ToolSort,
} from "../data/toolLibrary";
import type { Tool } from "../types";
import { idealThreadNeck, validThread } from "../engine/threadProfile";
import "./tool-library.css";

const LIBRARY = catalog.tools as Tool[];
const format = (value?: number, unit = "mm") =>
  value === undefined
    ? "—"
    : `${value.toLocaleString("en-US", { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ""}`;

function NumberField({
  label,
  value,
  onChange,
  min = 0.1,
  max = 200,
  unit = "mm",
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  unit?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const valid =
    draft.trim() !== "" &&
    Number.isFinite(+draft) &&
    +draft >= min &&
    +draft <= max;
  return (
    <label className="number-field">
      <span>{label}</span>
      <div>
        <input
          type="number"
          value={draft}
          min={min}
          max={max}
          step={0.01}
          aria-invalid={!valid}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            if (
              next !== "" &&
              Number.isFinite(+next) &&
              +next >= min &&
              +next <= max
            )
              onChange(+next);
          }}
          onBlur={() => {
            if (!valid) setDraft(String(value));
          }}
        />
        <span>{unit}</span>
      </div>
    </label>
  );
}

export default function ToolLibrary({
  number,
  current,
  onSelect,
  onClose,
}: {
  number: number;
  current?: Tool;
  onSelect: (tool: Tool) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<"catalog" | "custom">("catalog");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState(current?.id ?? "");
  const [sort, setSort] = useState<{ key: ToolSort; descending: boolean }>({
    key: "catalog",
    descending: false,
  });
  const [custom, setCustom] = useState<Tool>(
    current
      ? {
          ...current,
          kind: current.kind === "unsupported" ? "flat" : current.kind,
        }
      : {
          id: "custom",
          name: "Custom tool",
          kind: "flat",
          diameter: 3.175,
          length: 12,
          angle: 60,
          tip: 0.1,
          pitch: 0.8,
          neck: idealThreadNeck(3.175, 0.8),
        },
  );

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  const searched = useMemo(
    () => LIBRARY.filter((tool) => matchesToolSearch(tool, query)),
    [query],
  );
  const found = useMemo(
    () =>
      searched
        .filter((tool) => matchesToolGroup(tool, group))
        .sort(
          (a, b) => compareTools(a, b, sort.key) * (sort.descending ? -1 : 1),
        ),
    [searched, group, sort],
  );
  const selected = found.find((tool) => tool.id === selectedId) ?? found[0];
  const category = selected && toolCategory(selected);
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const tool of searched) {
      const category = toolCategory(tool);
      result.set(category.family, (result.get(category.family) ?? 0) + 1);
      if (category.group !== category.family)
        result.set(category.group, (result.get(category.group) ?? 0) + 1);
    }
    return result;
  }, [searched]);
  const availableGroups = useMemo(
    () => new Set(LIBRARY.map((tool) => toolCategory(tool).group)),
    [],
  );
  const activeGroup = TOOL_FAMILIES.flatMap((family) => [
    family,
    ...family.groups,
  ]).find((item) => item.id === group);

  function sortColumn(key: ToolSort, label: string) {
    const active = sort.key === key;
    return (
      <th
        scope="col"
        aria-sort={
          active ? (sort.descending ? "descending" : "ascending") : "none"
        }
      >
        <button
          onClick={() =>
            setSort({ key, descending: active && !sort.descending })
          }
        >
          {label}
          {active &&
            (sort.descending ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
        </button>
      </th>
    );
  }

  return (
    <dialog
      ref={dialog}
      className="modal tool-library"
      aria-labelledby="tool-library-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <h2 id="tool-library-title">
          Assign tool <span>· T{number}</span>
        </h2>
        <button className="icon-button" aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="library-tabs">
        <button
          className={tab === "catalog" ? "selected" : ""}
          aria-pressed={tab === "catalog"}
          onClick={() => setTab("catalog")}
        >
          Makera library <span>{LIBRARY.length}</span>
        </button>
        <button
          className={tab === "custom" ? "selected" : ""}
          aria-pressed={tab === "custom"}
          onClick={() => setTab("custom")}
        >
          Custom
        </button>
      </div>
      {tab === "catalog" ? (
        <>
          <div className="tool-library-search">
            <div className="search">
              <MagnifyingGlass size={17} />
              <input
                autoFocus
                aria-label="Search tools"
                placeholder="Search name, diameter or family…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button
                  className="icon-button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <span>{found.length} variants</span>
          </div>
          <div className="tool-library-body">
            <nav className="tool-library-tree" aria-label="Tool groups">
              <div className="tool-library-section-label">Tool Group</div>
              <button
                className={`tool-library-root ${group === "all" ? "selected" : ""}`}
                aria-pressed={group === "all"}
                onClick={() => setGroup("all")}
              >
                <Cylinder size={16} />
                <span>Makera Tools</span>
                <small>{searched.length}</small>
              </button>
              {TOOL_FAMILIES.map((family) => {
                const children = family.groups.filter((child) =>
                  availableGroups.has(child.id),
                );
                const expanded = !collapsed.includes(family.id);
                return (
                  <div className="tool-library-family" key={family.id}>
                    <div className="tool-library-family-row">
                      {children.length > 0 ? (
                        <button
                          className="tool-library-expander"
                          aria-label={`${expanded ? "Collapse" : "Expand"} ${family.label}`}
                          aria-expanded={expanded}
                          aria-controls={`tool-group-${family.id}`}
                          onClick={() =>
                            setCollapsed((value) =>
                              expanded
                                ? [...value, family.id]
                                : value.filter((id) => id !== family.id),
                            )
                          }
                        >
                          {expanded ? (
                            <CaretDown size={12} weight="fill" />
                          ) : (
                            <CaretRight size={12} weight="fill" />
                          )}
                        </button>
                      ) : (
                        <span className="tool-library-expander" />
                      )}
                      <button
                        className={group === family.id ? "selected" : ""}
                        aria-pressed={group === family.id}
                        onClick={() => setGroup(family.id)}
                      >
                        <span>{family.label}</span>
                        <small>{counts.get(family.id) ?? 0}</small>
                      </button>
                    </div>
                    {children.length > 0 && expanded && (
                      <div
                        id={`tool-group-${family.id}`}
                        className="tool-library-children"
                      >
                        {children.map((child) => (
                          <button
                            key={child.id}
                            className={group === child.id ? "selected" : ""}
                            aria-pressed={group === child.id}
                            onClick={() => setGroup(child.id)}
                          >
                            <span>{child.label}</span>
                            <small>{counts.get(child.id) ?? 0}</small>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
            <section
              className="tool-library-results"
              aria-label="Tools in this group"
            >
              <div className="tool-library-result-head">
                <strong>{activeGroup?.label ?? "All tools"}</strong>
                <button
                  onClick={() => setSort({ key: "catalog", descending: false })}
                >
                  Catalog order
                </button>
              </div>
              <div className="tool-library-table-scroll">
                <table className="tool-library-table">
                  <thead>
                    <tr>
                      {sortColumn("name", "Name")}
                      {sortColumn("type", "Type")}
                      {sortColumn("diameter", "Cut Ø")}
                      {sortColumn("length", "Cut length")}
                      {sortColumn("shank", "Shank")}
                    </tr>
                  </thead>
                  <tbody>
                    {found.map((tool) => (
                      <tr
                        key={tool.id}
                        className={`${selected?.id === tool.id ? "selected" : ""} ${tool.kind === "unsupported" ? "unsupported" : ""}`}
                        onClick={() => setSelectedId(tool.id)}
                      >
                        <td>
                          <button
                            className="tool-library-select"
                            aria-pressed={selected?.id === tool.id}
                            onClick={() => setSelectedId(tool.id)}
                          >
                            <span>{tool.name}</span>
                            {current?.id === tool.id && (
                              <Check
                                size={13}
                                aria-label="Currently assigned"
                              />
                            )}
                            {tool.kind === "unsupported" && (
                              <Warning size={13} aria-label="Toolpath only" />
                            )}
                          </button>
                        </td>
                        <td>{toolCategory(tool).familyLabel}</td>
                        <td>{format(tool.diameter, "")}</td>
                        <td>{format(tool.length, "")}</td>
                        <td>{format(tool.shank, "")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {found.length === 0 && (
                  <div className="empty">
                    No tools in this group match your search.
                    {group !== "all" && (
                      <button
                        className="button small"
                        onClick={() => setGroup("all")}
                      >
                        Search all groups
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="tool-library-units">
                Dimensions in mm · click a column to sort
              </div>
            </section>
            <aside
              className="tool-library-detail"
              aria-label="Tool information"
            >
              <div className="tool-library-section-label">Tool Information</div>
              {selected ? (
                <>
                  <div className="tool-library-profile">
                    <Cylinder size={35} weight="thin" />
                    <span>{category?.familyLabel}</span>
                  </div>
                  <h3>{selected.name}</h3>
                  <p className="tool-library-subgroup">
                    {category?.groupLabel}
                  </p>
                  <dl>
                    <div>
                      <dt>Cutting diameter</dt>
                      <dd>{format(selected.diameter)}</dd>
                    </div>
                    <div>
                      <dt>Cutting length</dt>
                      <dd>{format(selected.length)}</dd>
                    </div>
                    <div>
                      <dt>Shank diameter</dt>
                      <dd>{format(selected.shank)}</dd>
                    </div>
                    {selected.angle !== undefined && (
                      <div>
                        <dt>Included angle</dt>
                        <dd>{format(selected.angle, "°")}</dd>
                      </div>
                    )}
                    {selected.tip !== undefined && (
                      <div>
                        <dt>Tip diameter</dt>
                        <dd>{format(selected.tip)}</dd>
                      </div>
                    )}
                    {selected.kind === "thread" && (
                      <>
                        <div>
                          <dt>Reference pitch</dt>
                          <dd>{format(selected.pitch)}</dd>
                        </div>
                        <div>
                          <dt>Neck diameter (estimated)</dt>
                          <dd>{format(selected.neck)}</dd>
                        </div>
                      </>
                    )}
                  </dl>
                  {selected.kind === "unsupported" && (
                    <span className="badge">Toolpath only</span>
                  )}
                  {selected.kind === "thread" && (
                    <p className="muted">
                      WebGPU removal · idealized single-form tooth. Pitch and
                      handedness of the cut follow the G-code.
                    </p>
                  )}
                  {selected.source && (
                    <a
                      className="tool-library-source"
                      href={selected.source}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Makera specifications <ArrowSquareOut size={13} />
                    </a>
                  )}
                  <button
                    className="button primary"
                    onClick={() => onSelect(selected)}
                  >
                    {current?.id === selected.id && <Check size={14} />}
                    {`Assign to T${number}`}
                  </button>
                </>
              ) : (
                <p className="muted">Select a tool to view its dimensions.</p>
              )}
            </aside>
          </div>
          <div className="modal-foot">
            <span>Public catalog · {catalog.fetchedAt}</span>
            <a href={catalog.source} target="_blank" rel="noreferrer">
              Makera source <ArrowSquareOut size={13} />
            </a>
          </div>
        </>
      ) : (
        <div className="custom-tool">
          <label className="field-label">
            Name
            <input
              value={custom.name}
              onChange={(event) =>
                setCustom({ ...custom, name: event.target.value })
              }
            />
          </label>
          <label className="field-label">
            Profile
            <select
              value={custom.kind}
              onChange={(event) =>
                setCustom({
                  ...custom,
                  kind: event.target.value as Tool["kind"],
                  angle: custom.angle ?? 60,
                  tip: custom.tip ?? 0,
                  pitch: custom.pitch ?? 0.8,
                  neck:
                    custom.neck ??
                    idealThreadNeck(custom.diameter, custom.pitch ?? 0.8),
                })
              }
            >
              <option value="flat">Flat end mill</option>
              <option value="ball">Ball nose</option>
              <option value="v">V-bit</option>
              <option value="thread">Thread mill (WebGPU)</option>
            </select>
          </label>
          <div className="field-grid">
            <NumberField
              label="Diameter"
              value={custom.diameter}
              min={0.01}
              max={100}
              onChange={(diameter) => setCustom({ ...custom, diameter })}
            />
            <NumberField
              label="Cutting length"
              value={custom.length ?? 12}
              onChange={(length) => setCustom({ ...custom, length })}
            />
          </div>
          {custom.kind === "thread" && (
            <>
              <div className="field-grid">
                <NumberField
                  label="Tooth pitch"
                  value={custom.pitch ?? 0.8}
                  min={0.05}
                  max={10}
                  onChange={(pitch) => setCustom({ ...custom, pitch })}
                />
                <NumberField
                  label="Neck diameter"
                  value={
                    custom.neck ??
                    idealThreadNeck(custom.diameter, custom.pitch ?? 0.8)
                  }
                  min={0.01}
                  max={custom.diameter}
                  onChange={(neck) => setCustom({ ...custom, neck })}
                />
                <NumberField
                  label="Included angle"
                  value={custom.angle ?? 60}
                  min={1}
                  max={179}
                  unit="°"
                  onChange={(angle) => setCustom({ ...custom, angle })}
                />
              </div>
              <p className="hint">
                Single-form tooth. The thread pitch and handedness follow the
                G-code helix. Material removal requires WebGPU.
              </p>
            </>
          )}
          {custom.kind === "v" && (
            <div className="field-grid">
              <NumberField
                label="Included angle"
                value={custom.angle ?? 60}
                min={1}
                max={179}
                unit="°"
                onChange={(angle) => setCustom({ ...custom, angle })}
              />
              <NumberField
                label="Tip diameter"
                value={custom.tip ?? 0}
                min={0}
                max={custom.diameter}
                onChange={(tip) => setCustom({ ...custom, tip })}
              />
            </div>
          )}

          <button
            className="button primary"
            disabled={
              !custom.name.trim() ||
              (custom.kind === "thread" && !validThread(custom)) ||
              (custom.kind === "v" && (custom.tip ?? 0) > custom.diameter)
            }
            onClick={() =>
              onSelect({
                ...custom,
                id: `custom-${number}`,
                source: undefined,
                note: undefined,
              })
            }
          >
            Assign to T{number}
          </button>
        </div>
      )}
    </dialog>
  );
}
