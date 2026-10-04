// View-only state: never modifies the package or truncates deliverables.
export const REVIEW_PAGE_SIZES = [10, 20, 50];
export const isRequirementTodo = r => !r.equipmentId || r.reviewStatus !== 'confirmed';
const segmentFor = (source, evidence) => source?.segments.find(s => evidence.start >= s.start && evidence.end <= s.end);
export function requirementReviewPage(pack, { sourceId = '', equipmentId = '', status = '', keyword = '', page = 1, pageSize = 20 } = {}) {
  const sources = new Map(pack.sources.map((s, index) => [s.id, { source: s, index }]));
  const query = String(keyword).trim().toLocaleLowerCase();
  const rows = pack.requirements.map((requirement, index) => {
    const candidates = requirement.candidates.filter(c => !sourceId || c.evidence.sourceId === sourceId);
    const anchor = candidates.reduce((best, c) => {
      const rank = [sources.get(c.evidence.sourceId)?.index ?? Infinity, c.evidence.start];
      return rank[0] < best[0] || rank[0] === best[0] && rank[1] < best[1] ? rank : best;
    }, [Infinity, Infinity]);
    return { requirement, index, anchor, candidates };
  }).filter(({ requirement: r, candidates }) => {
    if (sourceId && !candidates.length) return false;
    if (equipmentId && (equipmentId === 'unassigned' ? !!r.equipmentId : r.equipmentId !== equipmentId)) return false;
    if (status && (status === 'todo' ? !isRequirementTodo(r) : r.reviewStatus !== status)) return false;
    if (!query) return true;
    const haystack = [r.field, pack.equipment.find(e => e.id === r.equipmentId)?.label || '', ...r.candidates.flatMap(c => {
      const source = sources.get(c.evidence.sourceId)?.source, segment = segmentFor(source, c.evidence);
      return [c.evidence.quote, source?.name || '', segment?.contextTitle || '', segment?.contextCell || '', segment?.sheet || '', segment?.cell || '',
        segment?.page == null ? '' : `PDF第${segment.page}页`, segment?.paragraph == null ? '' : `解析段落${segment.paragraph}`, segment?.table ? `解析表格${segment.table}` : ''];
    })].join('\n').toLocaleLowerCase();
    return haystack.includes(query);
  }).sort((a, b) => a.anchor[0] - b.anchor[0] || a.anchor[1] - b.anchor[1] || a.index - b.index).map(row => row.requirement);
  const size = REVIEW_PAGE_SIZES.includes(Number(pageSize)) ? Number(pageSize) : 20;
  const total = rows.length, totalPages = Math.ceil(total / size);
  const current = totalPages ? Math.max(1, Math.min(totalPages, Number.isSafeInteger(Number(page)) ? Number(page) : 1)) : 1;
  const offset = (current - 1) * size;
  return { items: rows.slice(offset, offset + size), ids: rows.map(r => r.id), total, totalPages, page: current, pageSize: size,
    start: total ? offset + 1 : 0, end: Math.min(offset + size, total) };
}
function basis(pack, requirement) {
  return { requirement: JSON.stringify(requirement), sources: [...new Set(requirement.candidates.map(c => c.evidence.sourceId))].map(id => {
    const source = pack.sources.find(s => s.id === id);
    return { id, text: source?.text, metadata: JSON.stringify([source?.type, source?.name, source?.segments]) };
  }) };
}
function sameBasis(a, b) {
  return a.requirement === b.requirement && a.sources.length === b.sources.length && a.sources.every((s, i) =>
    s.id === b.sources[i].id && s.text === b.sources[i].text && s.metadata === b.sources[i].metadata);
}
export function createRequirementDrafts() {
  const drafts = new Map();
  return {
    get size() { return drafts.size; },
    remember(pack, id, values) {
      const requirement = pack.requirements.find(r => r.id === id);
      if (!requirement) throw new Error('编辑条款已不存在');
      drafts.set(id, { basis: basis(pack, requirement), values: { ...values } });
    },
    get(id) { const entry = drafts.get(id); return entry ? { ...entry.values } : null; },
    clear(id) { if (id == null) drafts.clear(); else drafts.delete(id); },
    sync(pack) {
      const requirements = new Map(pack.requirements.map(r => [r.id, r])), dropped = [];
      for (const [id, entry] of drafts) {
        const requirement = requirements.get(id);
        if (!requirement || !sameBasis(entry.basis, basis(pack, requirement))) { drafts.delete(id); dropped.push(id); }
      }
      return dropped;
    }
  };
}
