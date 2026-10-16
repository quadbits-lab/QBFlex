import { useState, useEffect, useRef, Suspense, type ReactNode, isValidElement } from 'react';
import { Link } from '@tanstack/react-router';
import {
  Search,
  Menu,
  Sun,
  Moon,
  BookOpen,
  Code2,
  ChevronRight,
  Copy,
  Check,
  X,
  Terminal,
  ExternalLink,
  Rocket,
  PanelsTopLeft,
  Database,
  Workflow,
  ShieldCheck,
  Package,
  Atom,
  Braces,
  Settings2,
  Library,
  Map,
  type LucideIcon,
} from 'lucide-react';
import MiniSearch from 'minisearch';
import { Brand, Button, Badge, Modal, Drawer } from '@qb-flex/ui';
import { documents, documentBySlug } from './library';
const sectionIcons: Record<string, LucideIcon> = {
  'Getting started': Rocket,
  Studio: PanelsTopLeft,
  'Database & APIs': Database,
  Services: Workflow,
  Authentication: ShieldCheck,
  'Client SDK': Package,
  'Client SDK · React': Atom,
  'Client SDK · Vanilla JS': Braces,
  Operations: Settings2,
  Reference: Library,
  Roadmap: Map,
};
function SectionHeading({ section }: { section: string }) {
  const Icon = sectionIcons[section] ?? BookOpen;
  return (
    <h2>
      <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
      <span>{section}</span>
    </h2>
  );
}
export function DocsPage({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false),
    [navigation, setNavigation] = useState(false),
    [theme, setTheme] = useState('dark'),
    [input, setInput] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const search = useRef<MiniSearch | null>(null);
  const searchInput = useRef(input);
  searchInput.current = input;
  const doc = documentBySlug(slug)!;
  const index = documents.findIndex((d) => d.slug === slug);
  const previous = documents[index - 1],
    next = documents[index + 1];
  const sections = [...new Set(documents.map((d) => d.section))];
  useEffect(() => {
    const stored = localStorage.getItem('qb-docs-theme') ?? 'dark';
    setTheme(stored);
    document.documentElement.classList.toggle('light', stored === 'light');
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    if (!open || search.current) return;
    let active = true;
    fetch('/search-index.json')
      .then((r) => r.json())
      .then((items) => {
        if (!active) return;
        const engine = new MiniSearch({
          fields: ['title', 'text', 'section'],
          storeFields: ['title', 'slug', 'section'],
          searchOptions: { boost: { title: 4 }, prefix: true, fuzzy: 0.15 },
        });
        engine.addAll(items);
        search.current = engine;
        setResults(engine.search(searchInput.current));
      })
      .catch(() => setResults([]));
    return () => {
      active = false;
    };
  }, [open]);
  const update = (value: string) => {
    setInput(value);
    setResults(search.current?.search(value) ?? []);
  };
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('qb-docs-theme', next);
    document.documentElement.classList.toggle('light', next === 'light');
  };
  return (
    <div className="docs-app">
      <header className="docs-header">
        <button
          className="nav-toggle"
          onClick={() => setNavigation((v) => !v)}
          aria-label="Toggle documentation navigation"
          aria-expanded={navigation}
        >
          <Menu size={20} />
        </button>
        <Brand label="Docs" />
        <nav className="docs-top-nav">
          <Link
            to="/docs/$"
            params={{ _splat: 'getting-started/introduction' }}
            activeProps={{ className: 'active' }}
          >
            Documentation
          </Link>
          <Link to="/docs/$" params={{ _splat: 'sdk/overview' }}>
            Client SDK
          </Link>
          <Link to="/docs/$" params={{ _splat: 'cli/commands' }}>
            CLI
          </Link>
        </nav>
        <div className="docs-header-actions">
          <button
            className="search-button"
            aria-label="Search documentation"
            onClick={() => setOpen(true)}
          >
            <Search size={15} />
            <span>Search documentation</span>
            <kbd>⌘ K</kbd>
          </button>
          <button
            className="icon-button"
            onClick={toggleTheme}
            aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <a
            className="studio-link"
            href={import.meta.env.VITE_STUDIO_URL ?? 'http://localhost:7610'}
          >
            Open Studio <ExternalLink size={14} />
          </a>
        </div>
      </header>
      <div className="docs-layout">
        <aside className="docs-sidebar" aria-label="Documentation navigation">
          <div className="sidebar-start">
            <BookOpen size={16} />
            <span>Documentation</span>
            <Badge>v0.1</Badge>
          </div>
          {sections.map((section) => (
            <section key={section} className="nav-group">
              <SectionHeading section={section} />
              {documents
                .filter((d) => d.section === section)
                .map((d) => (
                  <Link
                    key={d.slug}
                    to="/docs/$"
                    params={{ _splat: d.slug }}
                    className={d.slug === slug ? 'selected' : ''}
                    onClick={() => setNavigation(false)}
                  >
                    {d.title}
                    {d.slug === slug && <ChevronRight size={14} />}
                  </Link>
                ))}
            </section>
          ))}
          <div className="sidebar-note">
            <Terminal size={17} />
            <p>
              Built with Bun.
              <br />
              Yours to self-host.
            </p>
          </div>
        </aside>
        <main id="main" className="docs-article">
          <div className="article-crumb">
            <BookOpen size={14} />
            <span>{doc.meta.section}</span>
            <ChevronRight size={12} />
            <span>{doc.meta.title}</span>
          </div>
          <div className="article-meta">
            <Badge>QB Flex / v0.1</Badge>
            {slug.startsWith('sdk/react/') && <Badge>React 19</Badge>}
            {slug.startsWith('sdk/vanilla/') && <Badge>Browser ESM</Badge>}
          </div>
          <article className="prose min-w-0 [overflow-wrap:anywhere]">
            <Suspense fallback={<p className="muted">Loading article…</p>}>
              <doc.Component components={{ pre: CodeBlock, Callout }} />
            </Suspense>
          </article>
          <div className="article-footer">
            <p>
              Documentation lives with the code. API references are generated from the same
              contracts.
            </p>
            <div className="doc-pagination">
              {previous ? (
                <Link to="/docs/$" params={{ _splat: previous.slug }}>
                  <small>Previous</small>
                  <strong>{previous.title}</strong>
                </Link>
              ) : (
                <span />
              )}
              {next && (
                <Link to="/docs/$" params={{ _splat: next.slug }}>
                  <small>Next</small>
                  <strong>{next.title}</strong>
                </Link>
              )}
            </div>
          </div>
        </main>
        <aside className="docs-toc">
          <p>On this page</p>
          {doc.meta.headings.slice(0, 20).map((h: any) => (
            <a href={'#' + h.id} key={h.id} style={{ paddingLeft: h.level === 3 ? 12 : 0 }}>
              {h.title}
            </a>
          ))}
          <div className="toc-divider" />
          <Link to="/docs/$" params={{ _splat: 'sdk/react/quickstart' }}>
            <Code2 size={15} /> React tutorial
          </Link>
          <Link to="/docs/$" params={{ _splat: 'sdk/vanilla/quickstart' }}>
            <Code2 size={15} /> JavaScript tutorial
          </Link>
        </aside>
      </div>
      <Drawer open={navigation} onOpenChange={setNavigation} title="Documentation">
        {sections.map((section) => (
          <section key={section} className="nav-group">
            <SectionHeading section={section} />
            {documents
              .filter((d) => d.section === section)
              .map((d) => (
                <Link
                  key={d.slug}
                  to="/docs/$"
                  params={{ _splat: d.slug }}
                  onClick={() => setNavigation(false)}
                >
                  {d.title}
                </Link>
              ))}
          </section>
        ))}
      </Drawer>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Search documentation"
        description="Find a guide, tutorial or reference."
      >
        <div className="search-input">
          <Search size={18} />
          <input
            autoFocus
            aria-label="Search documentation"
            placeholder="Try policies, React hooks, backups…"
            value={input}
            onChange={(e) => update(e.target.value)}
          />
        </div>
        <div className="search-results">
          {input && results.length === 0 && <p className="muted">No matching articles.</p>}
          {(input ? results : documents.slice(0, 6)).slice(0, 12).map((r: any) => (
            <Link
              key={r.slug}
              to="/docs/$"
              params={{ _splat: r.slug }}
              onClick={() => setOpen(false)}
            >
              <small>{r.section}</small>
              <strong>{r.title}</strong>
              <ChevronRight size={15} />
            </Link>
          ))}
        </div>
      </Modal>
    </div>
  );
}
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}
function CodeBlock(props: any) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <div className="code-block">
      <button
        aria-label="Copy code"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(textOf(props.children));
            setCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1800);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
      <pre {...props} />
    </div>
  );
}
function Callout({ children }: { children: ReactNode }) {
  return <aside className="notice">{children}</aside>;
}
