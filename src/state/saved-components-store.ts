import fs from 'node:fs';
import path from 'node:path';
import {
  SavedUiComponentSchema,
  type SavedUiComponent,
  type UiComponentNode,
  type UiPanelNode,
} from '../schema/ui-schema.js';

export function slugifyComponentName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'custom-component'
  );
}

export class SavedComponentsStore {
  private readonly filePath: string;
  private components: Map<string, SavedUiComponent> = new Map();

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, 'saved-components.json');
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) {
      this.components = new Map();
      return;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (Array.isArray(raw)) {
        for (const item of raw) {
          const parsed = SavedUiComponentSchema.safeParse(item);
          if (parsed.success) {
            this.components.set(parsed.data.slug, parsed.data);
          }
        }
      }
    } catch {
      this.components = new Map();
    }
  }

  private save(): void {
    fs.writeFileSync(
      this.filePath,
      JSON.stringify(Array.from(this.components.values()), null, 2),
      'utf8',
    );
  }

  list(): SavedUiComponent[] {
    return Array.from(this.components.values());
  }

  get(nameOrSlug: string): SavedUiComponent | undefined {
    const slug = slugifyComponentName(nameOrSlug);
    return this.components.get(slug);
  }

  saveComponent(input: {
    name: string;
    description?: string;
    panels?: UiPanelNode[];
    components?: UiComponentNode[];
    sourcePage?: string;
    sourceView?: number;
  }): SavedUiComponent {
    const slug = slugifyComponentName(input.name);
    const saved: SavedUiComponent = {
      id: `saved-${slug}`,
      name: input.name.trim(),
      slug,
      description: input.description,
      panels: input.panels ?? [],
      components: input.components ?? [],
      createdAt: new Date().toISOString(),
      sourcePage: input.sourcePage,
      sourceView: input.sourceView,
    };
    this.components.set(slug, saved);
    this.save();
    return saved;
  }

  remove(nameOrSlug: string): boolean {
    const slug = slugifyComponentName(nameOrSlug);
    const deleted = this.components.delete(slug);
    if (deleted) this.save();
    return deleted;
  }
}
