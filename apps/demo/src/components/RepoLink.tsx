import { FolderGit2, Heart } from 'lucide-react';

const GITHUB_USER = 'leptoquark1';
const REPO_NAME = 'openage-pfadfinder';

const linkClass = 'text-fg group-hover:text-red-200 underline-offset-2 hover:underline decoration-red-600 underline-offset-4 ';

/** Credits badge: GitHub user and repository of the library. */
export function RepoLink() {
  return (
    <div className="absolute bottom-3.5 left-3.5 flex items-start gap-2 rounded-lg border border-border bg-panel/85 px-3 py-2 font-mono text-[11px] text-muted backdrop-blur-sm group">
      <FolderGit2 size={14} strokeWidth={1.75} aria-hidden="true" className="group-hover:hidden" />
      <Heart size={14} strokeWidth={1.75} aria-hidden="true" className="hidden group-hover:inline text-red-600 animate-pulse" />
      <span>
        <a className={linkClass} href={`https://github.com/${GITHUB_USER}`} target="_blank" rel="noopener noreferrer">
          {GITHUB_USER}
        </a>
        {' / '}
        <a className={linkClass} href={`https://github.com/${GITHUB_USER}/${REPO_NAME}`} target="_blank" rel="noopener noreferrer">
          {REPO_NAME}
        </a>
      </span>
    </div>
  );
}
