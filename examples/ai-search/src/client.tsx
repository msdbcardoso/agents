import { Suspense, useCallback, useState, useEffect, useRef } from "react";
import Markdown from "react-markdown";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { isToolUIPart, getToolName } from "ai";
import type { UIMessage } from "ai";
import {
  Button,
  Badge,
  InputArea,
  Empty,
  Surface,
  Text,
  PoweredByCloudflare
} from "@cloudflare/kumo";
import {
  PaperPlaneRightIcon,
  StopIcon,
  TrashIcon,
  MagnifyingGlassIcon,
  UploadSimpleIcon,
  SidebarSimpleIcon,
  FileTextIcon,
  FileIcon,
  SpinnerGapIcon,
  CheckCircleIcon,
  InfoIcon,
  CaretDownIcon,
  CaretRightIcon,
  MoonIcon,
  SunIcon,
  XIcon,
  FloppyDiskIcon,
  FunnelIcon,
  DatabaseIcon,
  PlusIcon,
  CircleIcon,
  CheckIcon,
  GaugeIcon,
  ArrowBendUpLeftIcon
} from "@phosphor-icons/react";

type ConnectionStatus = "connecting" | "connected" | "disconnected";

function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const dot =
    status === "connected"
      ? "bg-green-500"
      : status === "connecting"
        ? "bg-yellow-500"
        : "bg-red-500";
  const text =
    status === "connected"
      ? "text-kumo-success"
      : status === "connecting"
        ? "text-kumo-warning"
        : "text-kumo-danger";
  const label =
    status === "connected"
      ? "Connected"
      : status === "connecting"
        ? "Connecting..."
        : "Disconnected";
  return (
    <div className="flex items-center gap-2" role="status">
      <span className={`size-2 rounded-full ${dot}`} />
      <span className={`text-xs ${text}`}>{label}</span>
    </div>
  );
}

function ModeToggle() {
  const [mode, setMode] = useState(
    () => localStorage.getItem("theme") || "light"
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-mode", mode);
    document.documentElement.style.colorScheme = mode;
    localStorage.setItem("theme", mode);
  }, [mode]);

  return (
    <Button
      variant="ghost"
      shape="square"
      aria-label="Toggle theme"
      onClick={() => setMode((m) => (m === "light" ? "dark" : "light"))}
      icon={mode === "light" ? <MoonIcon size={16} /> : <SunIcon size={16} />}
    />
  );
}

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter(
      (
        part
      ): part is Extract<(typeof message.parts)[number], { type: "text" }> =>
        part.type === "text"
    )
    .map((part) => part.text)
    .join("");
}

function fileIcon(name: string) {
  if (
    name.endsWith(".md") ||
    name.endsWith(".txt") ||
    name.endsWith(".html") ||
    name.endsWith(".csv")
  )
    return <FileTextIcon size={14} />;
  return <FileIcon size={14} />;
}

function pct(score: number | undefined): string {
  if (score == null) return "\u2014";
  return `${(score * 100).toFixed(0)}%`;
}

// -- Search result components --

interface SearchChunk {
  id: string;
  score: number;
  text: string;
  source: string;
  scoring_details?: {
    vector_score?: number;
    keyword_score?: number;
    fusion_method?: string;
  };
}

interface SearchResult {
  search_query: string;
  total_results: number;
  chunks: SearchChunk[];
  error?: string;
  hint?: string;
}

function ScoreBar({
  label,
  score,
  color,
  format = "pct"
}: {
  label: string;
  score: number | undefined;
  color: string;
  /** "pct" for 0-1 scores shown as %, "raw" for BM25-style raw scores */
  format?: "pct" | "raw";
}) {
  if (score == null) return null;
  // For raw scores (BM25), normalize to a visual bar width (cap at ~30 as "full")
  const barWidth =
    format === "raw"
      ? Math.min((score / 30) * 100, 100)
      : Math.min(score * 100, 100);
  const display = format === "raw" ? score.toFixed(1) : pct(score);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-kumo-inactive w-14 shrink-0">
        {label}
      </span>
      <div className="flex-1 h-1.5 rounded-full bg-kumo-elevated overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      <span className="text-[10px] font-mono text-kumo-subtle w-8 text-right">
        {display}
      </span>
    </div>
  );
}

function SourceCard({
  chunk,
  onMoreLikeThis
}: {
  chunk: SearchChunk;
  onMoreLikeThis?: (text: string, source: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const details = chunk.scoring_details;

  return (
    <div className="border border-kumo-line rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-kumo-elevated transition-colors text-left"
      >
        {expanded ? (
          <CaretDownIcon size={12} className="text-kumo-inactive shrink-0" />
        ) : (
          <CaretRightIcon size={12} className="text-kumo-inactive shrink-0" />
        )}
        {fileIcon(chunk.source)}
        <span className="text-xs font-medium text-kumo-default truncate flex-1">
          {chunk.source}
        </span>
        <Badge variant="secondary">{pct(chunk.score)}</Badge>
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {details && (
            <div className="space-y-1 pt-1">
              <ScoreBar
                label="Vector"
                score={details.vector_score}
                color="bg-blue-500"
              />
              <ScoreBar
                label="Keyword"
                score={details.keyword_score}
                color="bg-amber-500"
                format="raw"
              />
            </div>
          )}
          <p className="text-xs text-kumo-subtle leading-relaxed line-clamp-4">
            {chunk.text}
          </p>
          {onMoreLikeThis && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMoreLikeThis(chunk.text, chunk.source);
              }}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium text-kumo-accent hover:bg-kumo-elevated transition-colors"
            >
              <ArrowBendUpLeftIcon size={12} />
              More like this
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function isSearchResult(v: unknown): v is SearchResult {
  return typeof v === "object" && v !== null && "chunks" in v;
}

function SearchToolResult({
  output,
  onMoreLikeThis
}: {
  output: unknown;
  onMoreLikeThis?: (text: string, source: string) => void;
}) {
  if (!output || typeof output !== "object") return null;

  // Error shape from the search tool
  if ("error" in output) {
    const result = output as { error: string; hint?: string };
    return (
      <div className="px-3 py-2 rounded-lg bg-kumo-elevated">
        <span className="text-xs text-kumo-danger">{result.error}</span>
        {result.hint && (
          <span className="text-xs text-kumo-subtle block mt-0.5">
            {result.hint}
          </span>
        )}
      </div>
    );
  }

  if (!isSearchResult(output)) return null;
  const result = output;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="secondary">{result.total_results} chunks</Badge>
        {result.search_query && (
          <span className="text-[10px] text-kumo-inactive italic truncate flex-1">
            &ldquo;{result.search_query}&rdquo;
          </span>
        )}
      </div>
      <div className="space-y-1.5 max-h-80 overflow-y-auto">
        {result.chunks.map((chunk) => (
          <SourceCard
            key={chunk.id}
            chunk={chunk}
            onMoreLikeThis={onMoreLikeThis}
          />
        ))}
      </div>
    </div>
  );
}

// -- Instance management --

interface InstanceInfo {
  id: string;
  vector: boolean;
  keyword: boolean;
}

function InstancePanel({
  agent,
  isConnected,
  activeInstance,
  onActiveChange
}: {
  agent: { call: (method: string, args: unknown[]) => Promise<unknown> };
  isConnected: boolean;
  activeInstance: string | null;
  onActiveChange: (name: string | null) => void;
}) {
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newVector, setNewVector] = useState(true);
  const [newKeyword, setNewKeyword] = useState(true);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (): Promise<InstanceInfo[]> => {
    try {
      const result = (await agent.call("listInstances", [])) as InstanceInfo[];
      setInstances(result);
      return result;
    } catch {
      // Namespace may not be accessible yet
      return [];
    }
  }, [agent]);

  useEffect(() => {
    if (!isConnected) return;
    let aborted = false;
    // Sync active instance from server, auto-select first if none is set
    refresh().then(async (list) => {
      if (aborted) return;
      try {
        const r = (await agent.call("getActiveInstance", [])) as {
          activeInstance: string | null;
        };
        if (aborted) return;
        if (r.activeInstance) {
          onActiveChange(r.activeInstance);
        } else if (list && list.length > 0) {
          await agent.call("setActiveInstance", [list[0].id]);
          if (aborted) return;
          onActiveChange(list[0].id);
        }
      } catch {
        // ignore — server may not be ready yet
      }
    });
    return () => {
      aborted = true;
    };
  }, [isConnected, refresh, agent, onActiveChange]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setLoading(true);
    try {
      const result = (await agent.call("createInstance", [
        name,
        newVector,
        newKeyword
      ])) as { success: boolean; error?: string };
      if (result.success) {
        onActiveChange(name);
        setCreating(false);
        setNewName("");
        setNewVector(true);
        setNewKeyword(true);
        await refresh();
      } else {
        console.error("Failed to create instance:", result.error);
      }
    } catch (err) {
      console.error("createInstance failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (name: string) => {
    try {
      await agent.call("setActiveInstance", [name]);
      onActiveChange(name);
    } catch (err) {
      console.error("setActiveInstance failed:", err);
    }
  };

  const handleDelete = async (name: string) => {
    if (
      !window.confirm(
        `Delete instance "${name}"? All documents will be removed.`
      )
    )
      return;
    try {
      await agent.call("deleteInstance", [name]);
      if (activeInstance === name) onActiveChange(null);
      await refresh();
    } catch (err) {
      console.error("deleteInstance failed:", err);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <DatabaseIcon size={16} className="text-kumo-accent" />
        <Text size="sm" bold>
          Instances
        </Text>
        {instances.length > 0 && (
          <Badge variant="secondary">{instances.length}</Badge>
        )}
        <div className="flex-1" />
        <Button
          variant="ghost"
          shape="square"
          size="sm"
          aria-label="Create instance"
          icon={<PlusIcon size={14} />}
          onClick={() => setCreating(!creating)}
        />
      </div>

      {creating && (
        <div className="space-y-2 p-3 rounded-lg border border-kumo-line bg-kumo-elevated">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Instance name"
            className="w-full px-2 py-1.5 rounded-md border border-kumo-line bg-kumo-base text-xs text-kumo-default placeholder:text-kumo-inactive focus:outline-none focus:ring-1 focus:ring-kumo-accent"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
          />
          <div className="space-y-1">
            <span className="text-[10px] text-kumo-inactive uppercase tracking-wide">
              Index method
            </span>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={newVector}
                onChange={(e) => setNewVector(e.target.checked)}
                className="rounded"
              />
              <span className="text-xs text-kumo-default">Vector</span>
              <span className="text-[10px] text-kumo-inactive">
                — semantic similarity
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={newKeyword}
                onChange={(e) => setNewKeyword(e.target.checked)}
                className="rounded"
              />
              <span className="text-xs text-kumo-default">Keyword</span>
              <span className="text-[10px] text-kumo-inactive">
                — BM25 matching
              </span>
            </label>
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={handleCreate}
              disabled={
                !newName.trim() || (!newVector && !newKeyword) || loading
              }
            >
              {loading ? "Creating..." : "Create"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCreating(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {instances.length === 0 && !creating && (
        <div className="text-center py-3">
          <span className="text-xs text-kumo-inactive block">
            No instances yet
          </span>
          <span className="text-[10px] text-kumo-inactive block mt-0.5">
            Create one to start uploading documents
          </span>
        </div>
      )}

      {instances.length > 0 && (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {instances.map((inst) => {
            const isActive = activeInstance === inst.id;
            return (
              <button
                type="button"
                key={inst.id}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors text-left ${
                  isActive
                    ? "bg-kumo-elevated ring-1 ring-kumo-accent"
                    : "hover:bg-kumo-elevated"
                }`}
                onClick={() => handleSelect(inst.id)}
              >
                {isActive ? (
                  <CheckIcon
                    size={12}
                    weight="bold"
                    className="text-kumo-accent shrink-0"
                  />
                ) : (
                  <CircleIcon
                    size={12}
                    className="text-kumo-inactive shrink-0"
                  />
                )}
                <span className="text-xs text-kumo-default truncate flex-1">
                  {inst.id}
                </span>
                <div className="flex gap-1 shrink-0">
                  {inst.vector && <Badge variant="secondary">vec</Badge>}
                  {inst.keyword && <Badge variant="secondary">kw</Badge>}
                </div>
                <Button
                  variant="ghost"
                  shape="square"
                  size="sm"
                  aria-label={`Delete ${inst.id}`}
                  icon={<TrashIcon size={12} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(inst.id);
                  }}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// -- Upload panel --

interface UploadedFile {
  key: string;
  status: string;
  chunks_count: number;
}

function UploadPanel({
  agent,
  isConnected,
  refreshKey
}: {
  agent: { call: (method: string, args: unknown[]) => Promise<unknown> };
  isConnected: boolean;
  refreshKey: number;
}) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshFiles = useCallback(async () => {
    try {
      const result = (await agent.call("listFiles", [])) as UploadedFile[];
      setFiles(result);
    } catch {
      // Instance may not exist yet
    }
  }, [agent]);

  useEffect(() => {
    if (isConnected) refreshFiles();
  }, [isConnected, refreshFiles, refreshKey]);

  const isBusy = uploading !== null;

  const handleUpload = async (fileList: FileList) => {
    if (isBusy) return;
    for (const file of Array.from(fileList)) {
      setUploading(file.name);
      try {
        await agent.call("upload", [file.name, await file.text()]);
      } catch (err) {
        console.error(`Upload failed for ${file.name}:`, err);
      } finally {
        setUploading(null);
      }
      refreshFiles();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <UploadSimpleIcon size={16} className="text-kumo-accent" />
        <Text size="sm" bold>
          Documents
        </Text>
        {files.length > 0 && <Badge variant="secondary">{files.length}</Badge>}
      </div>

      <button
        type="button"
        aria-label="Upload files — drag and drop or click to browse"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length > 0)
            handleUpload(e.dataTransfer.files);
        }}
        onClick={() => !isBusy && fileInputRef.current?.click()}
        disabled={isBusy}
        className={`w-full border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
          isBusy
            ? "border-kumo-line cursor-wait"
            : dragOver
              ? "border-kumo-accent bg-kumo-elevated cursor-pointer"
              : "border-kumo-line hover:border-kumo-accent cursor-pointer"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".md,.txt,.html,.csv,.json,.xml"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleUpload(e.target.files);
            e.target.value = "";
          }}
        />
        {isBusy ? (
          <div className="flex items-center justify-center gap-2">
            <SpinnerGapIcon
              size={16}
              className="text-kumo-accent animate-spin"
            />
            <span className="text-xs text-kumo-subtle">
              Uploading {uploading}...
            </span>
          </div>
        ) : (
          <div>
            <UploadSimpleIcon
              size={20}
              className="text-kumo-inactive mx-auto mb-1"
            />
            <span className="text-xs text-kumo-subtle block">
              Drop files here or click to upload
            </span>
            <span className="text-[10px] text-kumo-inactive block mt-0.5">
              Markdown, Text, HTML, CSV, JSON, XML
            </span>
          </div>
        )}
      </button>

      {files.length > 0 && (
        <div className="space-y-1 max-h-60 overflow-y-auto">
          {files.map((file) => (
            <div
              key={file.key}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-kumo-elevated"
            >
              {fileIcon(file.key)}
              <span className="text-xs text-kumo-default truncate flex-1">
                {file.key}
              </span>
              {file.status === "completed" ? (
                <CheckCircleIcon
                  size={12}
                  className="text-kumo-success shrink-0"
                />
              ) : (
                <SpinnerGapIcon
                  size={12}
                  className="text-kumo-accent animate-spin shrink-0"
                />
              )}
              {file.chunks_count > 0 && (
                <span className="text-[10px] text-kumo-inactive shrink-0">
                  {file.chunks_count} chunks
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// -- Retrieval settings --

import type { RetrievalType, SearchDepth } from "./server";

const RETRIEVAL_OPTIONS: {
  value: RetrievalType;
  label: string;
  description: string;
}[] = [
  {
    value: "hybrid",
    label: "Hybrid",
    description: "Vector + keyword combined"
  },
  { value: "vector", label: "Vector", description: "Semantic similarity only" },
  {
    value: "keyword",
    label: "Keyword",
    description: "BM25 keyword matching only"
  }
];

function RetrievalSettings({
  agent,
  isConnected
}: {
  agent: { call: (method: string, args: unknown[]) => Promise<unknown> };
  isConnected: boolean;
}) {
  const [retrievalType, setRetrievalType] = useState<RetrievalType>("hybrid");

  // Sync with server on connect
  useEffect(() => {
    if (!isConnected) return;
    agent
      .call("getRetrievalType", [])
      .then((result) => {
        const r = result as { retrievalType: RetrievalType };
        setRetrievalType(r.retrievalType);
      })
      .catch(() => {});
  }, [isConnected, agent]);

  const handleChange = async (type: RetrievalType) => {
    setRetrievalType(type);
    try {
      await agent.call("setRetrievalType", [type]);
    } catch (err) {
      console.error("Failed to set retrieval type:", err);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <FunnelIcon size={16} className="text-kumo-accent" />
        <Text size="sm" bold>
          Retrieval
        </Text>
      </div>
      <div className="space-y-1" role="radiogroup" aria-label="Retrieval type">
        {RETRIEVAL_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={retrievalType === option.value}
            onClick={() => handleChange(option.value)}
            disabled={!isConnected}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
              retrievalType === option.value
                ? "bg-kumo-elevated ring-1 ring-kumo-accent"
                : "hover:bg-kumo-elevated"
            }`}
          >
            <span
              className={`size-3 rounded-full border-2 shrink-0 ${
                retrievalType === option.value
                  ? "border-kumo-accent bg-kumo-accent"
                  : "border-kumo-line"
              }`}
            />
            <div>
              <span className="text-xs font-medium text-kumo-default block">
                {option.label}
              </span>
              <span className="text-[10px] text-kumo-inactive">
                {option.description}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// -- Search depth --

const DEPTH_LABELS: {
  value: SearchDepth;
  label: string;
  description: string;
}[] = [
  { value: 1, label: "Quick", description: "1-2 searches, fast answer" },
  {
    value: 2,
    label: "Balanced",
    description: "3-5 searches, thorough answer"
  },
  {
    value: 3,
    label: "Deep Research",
    description: "5-10+ searches, comprehensive"
  }
];

function DepthSlider({
  agent,
  isConnected
}: {
  agent: { call: (method: string, args: unknown[]) => Promise<unknown> };
  isConnected: boolean;
}) {
  const [depth, setDepth] = useState<SearchDepth>(2);

  useEffect(() => {
    if (!isConnected) return;
    agent
      .call("getSearchDepth", [])
      .then((result) => {
        const r = result as { searchDepth: SearchDepth };
        setDepth(r.searchDepth);
      })
      .catch(() => {});
  }, [isConnected, agent]);

  const handleChange = async (value: number) => {
    const d = Math.max(1, Math.min(3, value)) as SearchDepth;
    setDepth(d);
    try {
      await agent.call("setSearchDepth", [d]);
    } catch (err) {
      console.error("Failed to set search depth:", err);
    }
  };

  const current =
    DEPTH_LABELS.find((l) => l.value === depth) ?? DEPTH_LABELS[1];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <GaugeIcon size={16} className="text-kumo-accent" />
        <Text size="sm" bold>
          Depth
        </Text>
        <div className="flex-1" />
        <Badge variant="secondary">{current.label}</Badge>
      </div>
      <div className="space-y-2">
        <input
          type="range"
          min={1}
          max={3}
          step={1}
          value={depth}
          onChange={(e) => handleChange(Number(e.target.value))}
          disabled={!isConnected}
          className="w-full accent-kumo-accent"
          aria-label="Search depth"
        />
        <div className="flex justify-between">
          {DEPTH_LABELS.map((l) => (
            <button
              key={l.value}
              type="button"
              onClick={() => handleChange(l.value)}
              disabled={!isConnected}
              className={`text-[10px] transition-colors ${
                depth === l.value
                  ? "text-kumo-accent font-medium"
                  : "text-kumo-inactive hover:text-kumo-subtle"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-kumo-inactive block">
          {current.description}
        </span>
      </div>
    </div>
  );
}

// -- Message rendering --

function AssistantMessage({
  message,
  isLast,
  isStreaming,
  onMoreLikeThis
}: {
  message: UIMessage;
  isLast: boolean;
  isStreaming: boolean;
  onMoreLikeThis: (text: string, source: string) => void;
}) {
  return (
    <div className="space-y-2">
      {message.parts.map((part, partIndex) => {
        if (part.type === "text") {
          if (!part.text) return null;
          const isLastTextPart = message.parts
            .slice(partIndex + 1)
            .every((p) => p.type !== "text");
          return (
            <div key={partIndex} className="flex justify-start">
              <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-bl-md bg-kumo-base text-kumo-default leading-relaxed">
                <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-pre:my-2 prose-code:text-[0.85em] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:bg-kumo-elevated">
                  <Markdown>{part.text}</Markdown>
                </div>
                {isLast && isLastTextPart && isStreaming && (
                  <span className="inline-block w-0.5 h-[1em] bg-kumo-brand ml-0.5 align-text-bottom animate-blink-cursor" />
                )}
              </div>
            </div>
          );
        }

        if (!isToolUIPart(part)) return null;
        const toolName = getToolName(part);
        const toolInput = part.input as Record<string, unknown> | undefined;
        const toolOutput = (part as { output?: unknown }).output;

        const isRunning =
          part.state === "input-available" || part.state === "input-streaming";
        const isDone = part.state === "output-available";
        const isError = part.state === "output-error";

        // Search tool — custom rendering
        if (toolName === "search") {
          return (
            <div key={part.toolCallId} className="flex justify-start">
              <Surface className="max-w-[90%] px-4 py-3 rounded-xl ring ring-kumo-line overflow-hidden">
                <div className="flex items-center gap-2 mb-2">
                  {isRunning ? (
                    <SpinnerGapIcon
                      size={14}
                      className="text-kumo-accent animate-spin"
                    />
                  ) : (
                    <MagnifyingGlassIcon
                      size={14}
                      className="text-kumo-accent"
                    />
                  )}
                  <Text size="xs" variant="secondary" bold>
                    {isRunning
                      ? `Searching: "${(toolInput as Record<string, unknown>)?.query ?? ""}"`
                      : "Search results"}
                  </Text>
                  {isDone && <Badge variant="primary">Done</Badge>}
                  {isError && <Badge variant="destructive">Error</Badge>}
                </div>
                {isDone && toolOutput != null && (
                  <SearchToolResult
                    output={toolOutput}
                    onMoreLikeThis={onMoreLikeThis}
                  />
                )}
              </Surface>
            </div>
          );
        }

        // save_document tool
        if (toolName === "save_document") {
          return (
            <div key={part.toolCallId} className="flex justify-start">
              <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
                <div className="flex items-center gap-2">
                  {isRunning ? (
                    <SpinnerGapIcon
                      size={14}
                      className="text-kumo-accent animate-spin"
                    />
                  ) : (
                    <FloppyDiskIcon size={14} className="text-kumo-accent" />
                  )}
                  <Text size="xs" variant="secondary" bold>
                    {isRunning
                      ? `Saving "${(toolInput as Record<string, unknown>)?.filename ?? ""}"`
                      : `Saved ${(toolOutput as Record<string, unknown>)?.filename ?? ""}`}
                  </Text>
                  {isDone && <Badge variant="primary">Done</Badge>}
                </div>
              </Surface>
            </div>
          );
        }

        // Fallback
        return (
          <div key={part.toolCallId} className="flex justify-start">
            <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
              <Text size="xs" variant="secondary" bold>
                {toolName}
              </Text>
              {isDone && toolOutput != null && (
                <pre className="mt-1 p-2 rounded-lg bg-kumo-elevated text-xs font-mono text-kumo-subtle overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(toolOutput, null, 2)}
                </pre>
              )}
            </Surface>
          </div>
        );
      })}
    </div>
  );
}

// -- Main chat --

function ThinkingIndicator({ messages }: { messages: UIMessage[] }) {
  const lastMessage = messages[messages.length - 1];
  // Show when the last message is from the user (assistant hasn't started yet)
  // or the assistant message has no visible text/tool content yet
  const isWaiting =
    !lastMessage ||
    lastMessage.role === "user" ||
    (lastMessage.role === "assistant" &&
      !lastMessage.parts.some(
        (p) => (p.type === "text" && p.text) || isToolUIPart(p)
      ));

  if (!isWaiting) return null;

  return (
    <div className="flex justify-start">
      <div className="px-4 py-2.5 rounded-2xl rounded-bl-md bg-kumo-base">
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <span className="size-1.5 rounded-full bg-kumo-inactive animate-bounce [animation-delay:0ms]" />
            <span className="size-1.5 rounded-full bg-kumo-inactive animate-bounce [animation-delay:150ms]" />
            <span className="size-1.5 rounded-full bg-kumo-inactive animate-bounce [animation-delay:300ms]" />
          </div>
          <span className="text-xs text-kumo-inactive">Thinking...</span>
        </div>
      </div>
    </div>
  );
}

function Chat() {
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showSidebar, setShowSidebar] = useState(true);

  const agent = useAgent({
    agent: "SearchAgent",
    onOpen: useCallback(() => setConnectionStatus("connected"), []),
    onClose: useCallback(() => setConnectionStatus("disconnected"), []),
    onError: useCallback(
      (error: Event) => console.error("WebSocket error:", error),
      []
    )
  });

  const { messages, sendMessage, clearHistory, stop, isStreaming } =
    useAgentChat({ agent });

  const isConnected = connectionStatus === "connected";
  const [activeInstance, setActiveInstance] = useState<string | null>(null);
  const [fileRefreshKey, setFileRefreshKey] = useState(0);

  const handleActiveChange = useCallback(
    (name: string | null) => {
      setActiveInstance(name);
      setFileRefreshKey((k) => k + 1);
    },
    [setActiveInstance, setFileRefreshKey]
  );

  // Refresh file list when agent saves a document
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      const lastAssistant = [...messages]
        .reverse()
        .find((m) => m.role === "assistant");
      const hasSave = lastAssistant?.parts.some(
        (p) =>
          isToolUIPart(p) &&
          getToolName(p) === "save_document" &&
          p.state === "output-available"
      );
      if (hasSave) setFileRefreshKey((k) => k + 1);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    sendMessage({ role: "user", parts: [{ type: "text", text }] });
  }, [input, isStreaming, sendMessage]);

  const handleMoreLikeThis = useCallback(
    (text: string, source: string) => {
      if (isStreaming) return;
      const snippet = text.length > 200 ? `${text.slice(0, 200)}...` : text;
      sendMessage({
        role: "user",
        parts: [
          {
            type: "text",
            text: `Find more content similar to this passage from "${source}":\n\n> ${snippet}`
          }
        ]
      });
    },
    [isStreaming, sendMessage]
  );

  return (
    <div className="flex h-screen bg-kumo-elevated">
      {/* Sidebar */}
      {showSidebar && (
        <aside className="w-80 border-r border-kumo-line bg-kumo-base flex flex-col">
          <div className="px-4 py-3 border-b border-kumo-line flex items-center justify-between">
            <Text size="sm" bold>
              Knowledge Base
            </Text>
            <Button
              variant="ghost"
              shape="square"
              size="sm"
              aria-label="Close sidebar"
              icon={<XIcon size={14} />}
              onClick={() => setShowSidebar(false)}
            />
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            <InstancePanel
              agent={agent}
              isConnected={isConnected}
              activeInstance={activeInstance}
              onActiveChange={handleActiveChange}
            />
            {activeInstance && (
              <>
                <div className="border-t border-kumo-line pt-4">
                  <UploadPanel
                    agent={agent}
                    isConnected={isConnected}
                    refreshKey={fileRefreshKey}
                  />
                </div>
                <div className="border-t border-kumo-line pt-4">
                  <RetrievalSettings agent={agent} isConnected={isConnected} />
                </div>
                <div className="border-t border-kumo-line pt-4">
                  <DepthSlider agent={agent} isConnected={isConnected} />
                </div>
              </>
            )}
          </div>
        </aside>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col">
        <header className="px-5 py-4 bg-kumo-base border-b border-kumo-line">
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              {!showSidebar && (
                <Button
                  variant="ghost"
                  shape="square"
                  aria-label="Open sidebar"
                  icon={<SidebarSimpleIcon size={16} />}
                  onClick={() => setShowSidebar(true)}
                />
              )}
              <h1 className="text-lg font-semibold text-kumo-default">
                Search Agent
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <ConnectionIndicator status={connectionStatus} />
              <ModeToggle />
              <Button
                variant="secondary"
                icon={<TrashIcon size={16} />}
                onClick={clearHistory}
              >
                Clear
              </Button>
            </div>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-5 py-6 space-y-5">
            {messages.length === 0 && (
              <div className="space-y-4">
                <Surface className="p-4 rounded-xl ring ring-kumo-line">
                  <div className="flex gap-3">
                    <InfoIcon
                      size={20}
                      weight="bold"
                      className="text-kumo-accent shrink-0 mt-0.5"
                    />
                    <div>
                      <Text size="sm" bold>
                        Search Agent
                      </Text>
                      <span className="mt-1 block">
                        <Text size="xs" variant="secondary">
                          This agent decomposes complex questions into focused
                          sub-queries, searches iteratively, evaluates results,
                          and synthesizes answers with source citations. Create
                          an AI Search instance from the sidebar, upload
                          documents, then ask questions.
                        </Text>
                      </span>
                    </div>
                  </div>
                </Surface>
                <Empty
                  icon={<MagnifyingGlassIcon size={32} />}
                  title={
                    activeInstance
                      ? "Upload documents and start searching"
                      : "Create an AI Search instance to get started"
                  }
                  description={
                    activeInstance
                      ? 'Try complex questions like "Compare the approaches described in these documents" or "What are the key differences between X and Y?"'
                      : "Use the sidebar to create an instance, then upload documents and ask questions."
                  }
                />
              </div>
            )}

            {messages.map((message, index) => {
              if (message.role === "user") {
                return (
                  <div key={message.id} className="flex justify-end">
                    <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-br-md bg-kumo-contrast text-kumo-inverse leading-relaxed">
                      {getMessageText(message)}
                    </div>
                  </div>
                );
              }

              return (
                <AssistantMessage
                  key={message.id}
                  message={message}
                  isLast={index === messages.length - 1}
                  isStreaming={isStreaming}
                  onMoreLikeThis={handleMoreLikeThis}
                />
              );
            })}

            {isStreaming && <ThinkingIndicator messages={messages} />}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-kumo-line bg-kumo-base">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="max-w-3xl mx-auto px-5 py-4"
          >
            <div className="flex items-end gap-3 rounded-xl border border-kumo-line bg-kumo-base p-3 shadow-sm focus-within:ring-2 focus-within:ring-kumo-ring focus-within:border-transparent transition-shadow">
              <InputArea
                value={input}
                onValueChange={setInput}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Ask a question about your documents..."
                disabled={!isConnected || isStreaming}
                rows={2}
                className="flex-1 !ring-0 focus:!ring-0 !shadow-none !bg-transparent !outline-none"
              />
              {isStreaming ? (
                <Button
                  type="button"
                  variant="secondary"
                  shape="square"
                  aria-label="Stop streaming"
                  onClick={stop}
                  icon={<StopIcon size={18} weight="fill" />}
                  className="mb-0.5"
                />
              ) : (
                <Button
                  type="submit"
                  variant="primary"
                  shape="square"
                  aria-label="Send message"
                  disabled={!input.trim() || !isConnected}
                  icon={<PaperPlaneRightIcon size={18} />}
                  className="mb-0.5"
                />
              )}
            </div>
          </form>
          <div className="flex justify-center pb-3">
            <PoweredByCloudflare href="https://developers.cloudflare.com/ai-search/" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen text-kumo-inactive">
          Loading...
        </div>
      }
    >
      <Chat />
    </Suspense>
  );
}
