import { useEffect, useMemo, useState } from "react";
import { Command, Search, TerminalSquare } from "lucide-react";

type PiCommand = {
  name: string;
  description: string;
  argumentHint?: string;
};

export function CommandsPage() {
  const [commands, setCommands] = useState<PiCommand[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/pi/commands")
      .then((res) => {
        if (!res.ok) throw new Error("Unable to load commands");
        return res.json() as Promise<{ commands?: PiCommand[] }>;
      })
      .then((data) => setCommands(data.commands ?? []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const visibleCommands = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword) return commands;
    return commands.filter((command) => `${command.name} ${command.argumentHint ?? ""} ${command.description}`.toLocaleLowerCase().includes(keyword));
  }, [commands, query]);

  return (
    <div className="skills-page">
      <header className="skills-page-heading">
        <div className="skills-page-mark command-page-mark"><Command className="h-5 w-5" /></div>
        <div><p className="skills-page-kicker">BUILT-IN COMMANDS</p><h1>Pi 内置命令</h1><p>当前安装版本提供 {commands.length} 个交互命令，在 Pi 输入框中以斜杠调用。</p></div>
      </header>
      <label className="skills-search"><Search className="h-4 w-4" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索命令或描述" /></label>
      {loading ? <p className="skills-page-status">正在读取 Pi 命令注册表…</p> : error ? <p className="skills-page-status">无法读取 Pi 内置命令。</p> : visibleCommands.length === 0 ? <p className="skills-page-status">没有匹配的命令。</p> : (
        <div className="skills-list">{visibleCommands.map((command) => <article className="skill-list-item" key={command.name}>
          <div className="skill-list-icon command-list-icon"><TerminalSquare className="h-4 w-4" /></div>
          <div className="skill-list-copy"><div><h2>{command.name}</h2>{command.argumentHint && <code>{command.argumentHint}</code>}<span>Pi 内置</span></div><p>{command.description}</p></div>
        </article>)}</div>
      )}
    </div>
  );
}
