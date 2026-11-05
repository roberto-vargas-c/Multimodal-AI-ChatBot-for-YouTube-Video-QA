// Schools of thought: so the architect can call up a position (phenomenology, typology …) and not only a person. Each
// position lists the authors who argue it; only the authors that are in the library take part. An author can hold more than one.

export interface Position { id: string; en: string; de: string; idea: string; authors: string[] }

export const positions: Position[] = [
  { id: "classical", en: "Classical theory", de: "Klassische Theorie",
    idea: "Firmness, commodity and delight; proportion and order drawn from the body and nature",
    authors: ["Vitruvius", "Leonardo da Vinci", "Alberti", "Palladio"] },
  { id: "craft", en: "Truth to materials and craft", de: "Materialgerechtigkeit und Handwerk",
    idea: "Honest construction, the hand of the maker, ornament that grows from material and nature",
    authors: ["John Ruskin", "Christopher Dresser", "William Morris"] },
  { id: "modernism", en: "Modernism", de: "Moderne",
    idea: "Form from purpose and construction, against applied ornament",
    authors: ["Adolf Loos", "Le Corbusier", "Mies van der Rohe", "Walter Gropius"] },
  { id: "typology", en: "Typology and the city", de: "Typologie und Stadt",
    idea: "Buildings as types that carry the memory of the city; the city as an artefact built over time",
    authors: ["Aldo Rossi", "Rob Krier", "Colin Rowe"] },
  { id: "postmodern", en: "Complexity and contradiction", de: "Komplexität und Widerspruch",
    idea: "Inclusive, layered, ambiguous architecture; the city as collage rather than a single plan",
    authors: ["Robert Venturi", "Colin Rowe", "Denise Scott Brown"] },
  { id: "phenomenology", en: "Phenomenology and place", de: "Phänomenologie und Ort",
    idea: "The spirit of a place, dwelling, and how architecture is experienced by the body and the senses",
    authors: ["Christian Norberg-Schulz", "Juhani Pallasmaa", "Peter Zumthor", "Steven Holl"] },
  { id: "perception", en: "Perception and proxemics", de: "Wahrnehmung und Proxemik",
    idea: "How people read, remember and use space: paths, edges, landmarks, personal distance",
    authors: ["Kevin Lynch", "Edward T. Hall"] },
  { id: "public-life", en: "Human-scale urbanism", de: "Stadt auf Augenhöhe",
    idea: "Public life between buildings, the eye level, small and tactical steps that make places work",
    authors: ["Jan Gehl", "Jane Jacobs", "Mike Lydon", "Llewelyn-Davies", "Roger Evans Associates", "UN-Habitat", "William H. Whyte"] },
  { id: "complexity", en: "Patterns, networks and space syntax", de: "Muster, Netze und Space Syntax",
    idea: "Space as a configuration that can be measured; patterns and connections that make urban structure alive",
    authors: ["Christopher Alexander", "Nikos A. Salingaros", "Bill Hillier"] },
  { id: "structuralism", en: "Structuralism", de: "Strukturalismus",
    idea: "A structure that leaves room for use; the in-between as a place of its own",
    authors: ["Herman Hertzberger", "Aldo van Eyck"] },
  { id: "form-order", en: "Form, order and structure", de: "Form, Ordnung und Tragwerk",
    idea: "The elements and systems of form, space and structure, and how the designer thinks with them",
    authors: ["Francis D.K. Ching", "Heino Engel", "Paul Laseau", "Beth Tondreau"] },
  { id: "climate", en: "Climate, light and environment", de: "Klima, Licht und Umwelt",
    idea: "Daylight, climate and energy as givers of form",
    authors: ["Alison G. Kwok", "Derek Phillips", "Victor Olgyay"] },
  { id: "computation", en: "Computational design and fabrication", de: "Computational Design und Fertigung",
    idea: "Material systems, robots and code as part of the design, from file to building",
    authors: ["Achim Menges", "Fabio Gramazio", "Ruairi Glynn"] },
  { id: "practice", en: "Building types and practice", de: "Gebäudetypen und Praxis",
    idea: "The accumulated rules of a building type: sizes, adjacencies, the site and what clients need",
    authors: ["Ernst Neufert", "Michael Kobus", "Hardo Braun", "Mark Dudek", "James A. LaGro", "Rosan Bosch"] },
];

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
// the surname is enough ("Gehl", "Norberg-Schulz"), so "J. Gehl" and "Jan Gehl" are the same author
const surname = (s: string) => norm(s).split(" ").pop() ?? "";

export function sameAuthor(a: string, b: string): boolean {
  const x = norm(a), y = norm(b);
  if (x === y) return true;
  const sx = surname(a), sy = surname(b);
  return sx.length > 2 && sx === sy && (x.includes(y) || y.includes(x) || x[0] === y[0]);
}

/** The positions an author of the library holds */
export function positionsOf(author: string): string[] {
  return positions.filter(p => p.authors.some(a => sameAuthor(a, author))).map(p => p.id);
}

/** The positions with at least one author in the library, each with those authors (as the library spells them) */
export function inLibrary(library: string[]): (Omit<Position, "authors"> & { authors: string[] })[] {
  return positions.map(p => ({ ...p, authors: library.filter(a => p.authors.some(x => sameAuthor(x, a))) })).filter(p => p.authors.length > 0);
}

export const position = (id?: string) => positions.find(p => p.id === id);
