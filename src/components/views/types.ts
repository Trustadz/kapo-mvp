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
  refresh: () => void;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
  openMoveDialog: (projectId: string, destinationId?: string) => void;
  openCreateDialog: () => void;
}
