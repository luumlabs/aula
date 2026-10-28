// Búsqueda en los materiales: BM25 (port de SearchIndex.swift + SearchText.swift) y el punto de extensión híbrido.
export { SearchIndex, decodeIndexChunks, validChunk, MAX_DECODED_BYTES, type SearchHit, type SearchOptions } from './searchIndex'
export { tokenize, terms, fold, stemWord, withoutScripts, withoutSuperscripts, containsCJK, isSingleCJK, STOPWORDS, type Token } from './text'
export { fuseRankings, reciprocalRankFusion, hybridSearch, type Embedder, type EmbeddingRole, type VectorHit, type VectorSearcher, type FusedResult, type HybridOptions } from './hybrid'
export { searchCourse, loadCourseIndex, isCourseIndexReady, rebuildCourseIndex, invalidateCourseIndex, saveCourseIndex, plainSnippet, type CourseSearchOptions } from './course'
export { LibrarySearch, librarySearch, contentChunks, contentSignature, lessonChunks, plainContent, textOf, type LibrarySearchOptions } from './library'
