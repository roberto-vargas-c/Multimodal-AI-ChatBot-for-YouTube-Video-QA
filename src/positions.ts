// Schools of thought: so the architect can call up a position (phenomenology, typology …) and not only a person. Each
// position lists the authors who argue it; only the authors that are in the library take part. An author can hold more than one.
// Every Pritzker laureate in the library holds one. The list is ordered: calling up a position seats its first three in the library.

export interface Position { id: string; en: string; de: string; idea: string; authors: string[] }

export const positions: Position[] = [
  { id: "classical", en: "Classical theory", de: "Klassische Theorie",
    idea: "Firmness, commodity and delight; proportion and order drawn from the body and nature",
    authors: ["Vitruvius", "Leonardo da Vinci", "Alberti", "Palladio"] },
  { id: "craft", en: "Truth to materials and craft", de: "Materialgerechtigkeit und Handwerk",
    idea: "Honest construction, the hand of the maker, ornament that grows from material and nature",
    authors: ["John Ruskin", "Christopher Dresser", "William Morris", "Wang Shu", "Liu Jiakun", "Smiljan Radić", "Jacques Herzog"] },
  { id: "modernism", en: "Modernism", de: "Moderne",
    idea: "Form from purpose and construction, against applied ornament",
    authors: ["Adolf Loos", "Le Corbusier", "Mies van der Rohe", "Walter Gropius", "Paulo Mendes da Rocha", "Eduardo Souto de Moura"] },
  { id: "typology", en: "Typology and the city", de: "Typologie und Stadt",
    idea: "Buildings as types that carry the memory of the city; the city as an artefact built over time",
    authors: ["Aldo Rossi", "Rob Krier", "Colin Rowe", "Rafael Moneo", "David Chipperfield", "Grafton Architects", "Christian de Portzamparc"] },
  { id: "postmodern", en: "Complexity and contradiction", de: "Komplexität und Widerspruch",
    idea: "Inclusive, layered, ambiguous architecture; the city as collage rather than a single plan",
    authors: ["Robert Venturi", "Colin Rowe", "Denise Scott Brown", "Rem Koolhaas", "Arata Isozaki"] },
  { id: "phenomenology", en: "Phenomenology and place", de: "Phänomenologie und Ort",
    idea: "The spirit of a place, dwelling, and how architecture is experienced by the body and the senses",
    authors: ["Christian Norberg-Schulz", "Juhani Pallasmaa", "Peter Zumthor", "Steven Holl", "Tadao Ando", "Álvaro Siza", "RCR Arquitectes"] },
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
    authors: ["Herman Hertzberger", "Aldo van Eyck", "Fumihiko Maki"] },
  { id: "form-order", en: "Form, order and structure", de: "Form, Ordnung und Tragwerk",
    idea: "The elements and systems of form, space and structure, and how the designer thinks with them",
    authors: ["Francis D.K. Ching", "Heino Engel", "Paul Laseau", "Beth Tondreau"] },
  { id: "climate", en: "Climate, light and environment", de: "Klima, Licht und Umwelt",
    idea: "Daylight, climate and energy as givers of form",
    authors: ["Alison G. Kwok", "Derek Phillips", "Victor Olgyay", "Glenn Murcutt", "Francis Kéré"] },
  { id: "deconstruction", en: "Deconstruction and free form", de: "Dekonstruktion und freie Form",
    idea: "Form freed from the box: fragmented, folded and fluid volumes that unsettle the expected order",
    authors: ["Zaha Hadid", "Frank Gehry", "Thom Mayne"] },
  { id: "high-tech", en: "High-tech and lightweight structure", de: "High-Tech und Leichtbau",
    idea: "The building as an engineered, legible system: structure, services and light, with as little material as possible",
    authors: ["Norman Foster", "Richard Rogers", "Renzo Piano", "Frei Otto"] },
  { id: "lightness", en: "Lightness and transparency", de: "Leichtigkeit und Transparenz",
    idea: "Thin, light and open architecture that blurs inside and outside, and dissolves into light and its surroundings",
    authors: ["SANAA", "Toyo Ito", "Jean Nouvel"] },
  { id: "social", en: "Housing, participation and social purpose", de: "Wohnen, Teilhabe und sozialer Auftrag",
    idea: "Architecture for the many: generosity with scarce means, incremental and shared space, never demolish when you can transform",
    authors: ["Lacaton & Vassal", "Alejandro Aravena", "Balkrishna Doshi", "Riken Yamamoto", "Shigeru Ban"] },
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
  // in the position's own order, so the authors who define it are the ones seated first
  return positions.map(p => ({ ...p, authors: [...new Set(p.authors.flatMap(x => library.filter(a => sameAuthor(x, a))))] }))
    .filter(p => p.authors.length > 0);
}

export const position = (id?: string) => positions.find(p => p.id === id);
