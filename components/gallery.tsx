"use client";

import Image from "next/image";
import Link from "next/link";
import { Search } from "lucide-react";
import { useState } from "react";
import type { Prototype } from "@/lib/prototypes";
import { Badge } from "@/components/ui/badge";

export function Gallery({ prototypes }: { prototypes: Prototype[] }) {
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const filtered = prototypes.filter((item) =>
    (showHidden || !item.hidden) &&
    `${item.title} ${item.description} ${item.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <label className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search prototypes" className="h-12 w-full rounded-lg border border-border bg-card pl-10 pr-3" />
        </label>
        <button type="button" onClick={() => setShowHidden((value) => !value)} className="h-12 rounded-lg border border-border bg-card px-4">
          {showHidden ? "Hide hidden" : "Show hidden"}
        </button>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {filtered.map((prototype) => (
          <Link key={prototype.slug} href={`/prototypes/${prototype.slug}`} className="group overflow-hidden rounded-xl border border-border bg-card">
            <div className="relative aspect-16/10 bg-muted">
              <Image src={`/thumbnails/${prototype.slug}-light.png`} alt="" fill sizes="(max-width: 640px) 100vw, 50vw" className="object-cover dark:hidden" />
              <Image src={`/thumbnails/${prototype.slug}-dark.png`} alt="" fill sizes="(max-width: 640px) 100vw, 50vw" className="hidden object-cover dark:block" />
            </div>
            <div className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-semibold">{prototype.title}</h2>
                {prototype.hidden && <Badge>Hidden</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">{prototype.description}</p>
            </div>
          </Link>
        ))}
      </div>
      {filtered.length === 0 && <p className="py-16 text-center text-sm text-muted-foreground">No prototypes found.</p>}
    </>
  );
}
