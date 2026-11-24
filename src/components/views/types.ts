import type { CollectionView, Status } from '@/lib/types';
import type {
  ProjectCard,
  ProjectSettingsData,
  ProjectWithParent,
} from '@/components/projects/types';

export interface CollectionViewContext {
  /** Project page that owns this collection. */
  projectId: string;
  projectTitle: string;
  statuses: Status[];
  settings: ProjectSettingsData;
  canEdit: boolean;
  view: CollectionView;
  children: ProjectCard[];
  descendants: ProjectWithParent[];
  /**
   * Tree rows present only as ancestors of filter matches (issue #55). They
   * keep the hierarchy connected and must render muted and read-only.
   */
  contextIds?: ReadonlySet<string>;
  refresh: () => void;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
  openMoveDialog: (projectId: string, destinationId?: string) => void;
  /** Opens the shared confirmation dialog for trashing one child project. */
  openTrashDialog: (projectId: string) => void;
  openCreateDialog: () => void;
}
