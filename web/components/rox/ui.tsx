"use client";

/**
 * 시안 공통 계약 — roxlogy-renewal/source/components/rox/ui.tsx 를 그대로 옮긴 것.
 * docs/design/PORT_PLAN.md §1-a.
 *
 * 시안과 다른 곳:
 *   - Link 는 시안의 전체 이동(`./navigation`) 대신 next/link (PORT_PLAN §1-c)
 *   - 시안의 RowLink(기록 행 UI)는 우리 components/row-link.tsx(프리페치 제어)와
 *     이름이 겹쳐 **RecordRow** 로 들여온다. 목록 행에는 우리 RowLink 를 쓴다.
 *   - 한국어로 박혀 있던 기본 문구(placeholder·aria-label)는 호출자가 t() 로 넘긴다.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, Search, Inbox } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Empty as EmptyPrimitive } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={"rx-panel " + className}>
      {title && (
        <div className="rx-panel-head">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHead({
  title,
  description,
  action,
  eyebrow = "ROXLOGY / PERFORMANCE LAB",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="rx-page-head">
      <div>
        <div className="rx-eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Go({
  href,
  children,
  primary = false,
}: {
  href: string;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <Button
      asChild
      variant={primary ? "default" : "outline"}
      className={primary ? "rx-primary" : ""}
    >
      <Link href={href}>{children}</Link>
    </Button>
  );
}

export function Back({ href, label }: { href: string; label: string }) {
  return (
    <Link className="rx-back" href={href}>
      <ArrowLeft size={16} />
      {label}
    </Link>
  );
}

export function Chip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "yellow" | "green" | "blue" | string;
}) {
  return <span className={"rx-chip " + tone}>{children}</span>;
}

export function Choice({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  /** 값 문자열, 또는 [값, 표시 문구] */
  options: (string | [string, string])[];
  label: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => {
          const [v, text] = typeof o === "string" ? [o, o] : o;
          return (
            <SelectItem value={v} key={v}>
              {text}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

export function Find({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="rx-find">
      <Search size={17} />
      <Input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function Segments({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  /** 값 문자열, 또는 [값, 표시 문구] */
  options: (string | [string, string])[];
  label: string;
}) {
  return (
    <Tabs value={value} onValueChange={onChange}>
      <TabsList className="rx-segments" aria-label={label}>
        {options.map((o) => {
          const [v, text] = typeof o === "string" ? [o, o] : o;
          return (
            <TabsTrigger
              value={v}
              key={v}
              className={value === v ? "active" : ""}
            >
              {text}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}

export function NavTabs({
  items,
  path,
}: {
  items: [string, string][];
  path: string;
}) {
  return (
    <nav className="rx-navtabs">
      {items.map(([name, href]) => (
        <Link
          key={href}
          aria-current={path === href ? "page" : undefined}
          className={path === href ? "active" : ""}
          href={href}
        >
          {name}
        </Link>
      ))}
    </nav>
  );
}

export function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: ReactNode[][];
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {headers.map((h) => (
            <TableHead key={h}>{h}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={i}>
            {r.map((v, j) => (
              <TableCell key={j}>{v}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <EmptyPrimitive className="rx-empty">
      <Inbox size={32} />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </EmptyPrimitive>
  );
}

export function Stats({ items }: { items: [string, string, string][] }) {
  return (
    <div className="rx-stats">
      {items.map(([label, value, note]) => (
        <div className="rx-stat" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
          <p>{note}</p>
        </div>
      ))}
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="rx-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="rx-hint">{children}</p>;
}

/** 시안의 RowLink — 제목·부제·끝값이 있는 기록 행 링크 */
export function RecordRow({
  href,
  title,
  note,
  end,
}: {
  href: string;
  title: string;
  note?: string;
  end?: ReactNode;
}) {
  return (
    <Link className="rx-record-row" href={href}>
      <span>
        <b>{title}</b>
        {note && <small>{note}</small>}
      </span>
      {end && <strong>{end}</strong>}
      <ArrowRight size={16} />
    </Link>
  );
}

export function ProgressBar({
  value,
  label,
}: {
  value: number;
  label: string;
}) {
  return <Progress aria-label={label} className="rx-progress" value={value} />;
}

/** "m:ss" / "h:mm:ss" → 초. 형식이 어긋나면 NaN */
export function seconds(value: string) {
  const p = value.trim().split(":");
  if (!/^\d{1,3}:[0-5]\d(?::[0-5]\d)?$/.test(value.trim())) return NaN;
  return p.reduce((s, n) => s * 60 + Number(n), 0);
}

/** 초 → "m:ss" / "h:mm:ss" */
export function clock(s: number) {
  if (!Number.isFinite(s)) return "—";
  const n = Math.max(0, Math.round(s));
  return n >= 3600
    ? `${Math.floor(n / 3600)}:${String(Math.floor((n % 3600) / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`
    : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}
