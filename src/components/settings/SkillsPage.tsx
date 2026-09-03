import { useEffect, useMemo, useState } from "react";
import { BookOpenCheck, Search, Sparkles } from "lucide-react";

type Skill = {
  name: string;
  description: string;
  source: "Pi" | "Agents" | "Codex";
};

const sourceLabel: Record<Skill["source"], string> = {
  Pi: "Pi",
  Agents: "本地 Agents",
  Codex: "Codex",
};

export function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/pi/skills")
      .then((res) => {
        if (!res.ok) throw new Error("Unable to load skills");
        return res.json() as Promise<{ skills?: Skill[] }>;
      })
      .then((data) => setSkills(data.skills ?? []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const visibleSkills = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword) return skills;
    return skills.filter((skill) => `${skill.name} ${skill.description} ${skill.source}`.toLocaleLowerCase().includes(keyword));
  }, [query, skills]);

  return (
    <div className="skills-page">
      <header className="skills-page-heading">
        <div className="skills-page-mark"><Sparkles className="h-5 w-5" /></div>
        <div><p className="skills-page-kicker">LOCAL CAPABILITIES</p><h1>Skills</h1><p>已发现 {skills.length} 个本地能力包，可在对话中按需调用。</p></div>
      </header>
      <label className="skills-search"><Search className="h-4 w-4" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或描述" /></label>
      {loading ? <p className="skills-page-status">正在读取本地 Skills…</p> : error ? <p className="skills-page-status">无法读取本地 Skills。</p> : visibleSkills.length === 0 ? <p className="skills-page-status">没有匹配的 Skills。</p> : (
        <div className="skills-list">{visibleSkills.map((skill) => <article className="skill-list-item" key={`${skill.source}:${skill.name}`}>
          <div className="skill-list-icon"><BookOpenCheck className="h-4 w-4" /></div>
          <div className="skill-list-copy"><div><h2>{skill.name}</h2><span>{sourceLabel[skill.source]}</span></div><p>{skill.description}</p></div>
        </article>)}</div>
      )}
    </div>
  );
}
