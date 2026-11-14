// English/French strings for the company pages. The Atmosphere page, the docs and the blog
// are English only; on those pages the language switch leads to the French home page.

export type Lang = 'en' | 'fr';

// Pages that exist in both languages, keyed by their English path.
const pairs: Record<string, string> = {
  '/': '/fr/',
  '/contact/': '/fr/contact/',
  '/privacy/': '/fr/confidentialite/',
};

const normalize = (path: string) => (path.endsWith('/') ? path : path + '/');

export function langOf(path: string): Lang {
  return normalize(path).startsWith('/fr/') ? 'fr' : 'en';
}

/** Paths of this page in each language, or null when the page has no translation. */
export function translations(path: string): Record<Lang, string> | null {
  const p = normalize(path);
  if (pairs[p]) return { en: p, fr: pairs[p] };
  const en = Object.keys(pairs).find((k) => pairs[k] === p);
  return en ? { en, fr: p } : null;
}

/** Where the language switch leads: the translated page, or the other language's home page. */
export function switchTarget(path: string): string {
  const t = translations(path);
  const other: Lang = langOf(path) === 'fr' ? 'en' : 'fr';
  if (t) return t[other];
  return other === 'fr' ? '/fr/' : '/';
}

export const ui = {
  en: {
    home: '/',
    contact: '/contact/',
    privacy: '/privacy/',
    nav: {
      services: 'Services',
      support: 'Support',
      docs: 'Docs',
      blog: 'Blog',
      cta: 'Contact us',
      switchLabel: 'FR',
      switchAria: 'FR, version française',
      menu: 'Toggle menu',
      main: 'Main navigation',
    },
    footer: {
      services: 'Services',
      docs: 'Docs',
      support: 'Support',
      blog: 'Blog',
      contact: 'Contact',
      privacy: 'Privacy',
      rights: 'All rights reserved.',
    },
    meta: {
      title: 'Async IO — Software development and AI consulting',
      description:
        'Async IO is an independent software company. We develop Atmosphere, mirroir and TrailSnag, provide Atmosphere enterprise support, and offer architecture, development and AI-assisted development consulting.',
    },
    hero: {
      title: 'Software development and AI consulting',
      lines: [
        'Consulting, fractional CTO and software architecture.',
        'We help development teams move to AI-assisted development.',
      ],
      contact: 'Contact us',
      services: 'Services',
    },
    products: {
      title: 'What we maintain',
      atmosphereMeta: 'Enterprise support',
      atmosphereAlt: 'The Atmosphere Console: a coordinator sends a prompt to four agents and writes the briefing',
      mirroirAlt: 'Claude using mirroir to build a grocery list on an iPhone from a recipe video',
      trailsnagAlt: 'TrailSnag steward desk: snag map, stats and trail status',
      support: 'Support',
      atmosphere:
        'Framework for real-time AI agents on the JVM. Agents stream over WebSocket and SSE, speak MCP, A2A and AG-UI, and run on Spring Boot or Quarkus.',
      mirroir:
        'An AI agent that drives a real iPhone. It turns a recipe video into a grocery list, plays games and gets things done in any app on the phone.',
      trailsnag:
        'Trail-issue reporting for trail networks. Hikers report a problem in 30 seconds with no account, and the trail stewards handle it on a map.',
      learnMore: 'Overview',
    },
    services: {
      title: 'Services',
      groups: [
        {
          title: 'Technical leadership',
          items: ['Fractional CTO', 'Technical advisory', 'Technical due diligence', 'R&D tax credits and funding'],
        },
        {
          title: 'Development',
          items: [
            'Architecture and system design',
            'Product development',
            'Performance and scalability',
            'Real-time and streaming systems',
          ],
        },
        {
          title: 'AI',
          items: [
            'Helping teams adopt AI-assisted development with Claude Code',
            'Building AI agents',
            'Agent skills',
            'Multi-agent coordination',
            'Project setup for AI-assisted teams',
            'Atmosphere support and migration',
          ],
        },
      ],
    },
    work: {
      title: 'Selected work',
      cases: [
        {
          sector: 'Developer-tools vendor',
          title: 'Performance-testing compiler',
          summary: 'Built a high-performance compiler for performance testing.',
        },
        {
          sector: 'Consumer AI coaching',
          title: 'Multi-tenant AI platform',
          summary:
            'Co-founded Dravr and built the entire stack with Claude Code: a multi-tenant Rust backend, a web app and a React Native mobile app. The AI coach reads the athlete’s Strava, Garmin and Whoop data and answers on the web, on the phone, in messaging apps and in any assistant that speaks MCP.',
        },
        {
          sector: 'Online games',
          title: 'Real-time multiplayer games',
          summary: 'GameDuell uses Atmosphere in all of its games that need to deliver events in real time.',
        },
        {
          sector: 'Generative AI startup',
          title: 'Fractional CTO',
          summary:
            'Took a proof of concept built by a consulting firm to a production RAG platform for the first customers, with monitoring for stability and scale. Helped build the company, including pitching it to pre-seed investors.',
        },
      ],
    },
    cta: {
      title: 'Contact',
      book: 'Book a call',
    },
  },
  fr: {
    home: '/fr/',
    contact: '/fr/contact/',
    privacy: '/fr/confidentialite/',
    nav: {
      services: 'Services',
      support: 'Support',
      docs: 'Docs',
      blog: 'Blogue',
      cta: 'Contactez-nous',
      switchLabel: 'EN',
      switchAria: 'EN, English version',
      menu: 'Ouvrir ou fermer le menu',
      main: 'Navigation principale',
    },
    footer: {
      services: 'Services',
      docs: 'Docs',
      support: 'Support',
      blog: 'Blogue',
      contact: 'Contact',
      privacy: 'Confidentialité',
      rights: 'Tous droits réservés.',
    },
    meta: {
      title: 'Async IO — Développement logiciel et consultation en IA',
      description:
        'Async IO est une entreprise de logiciels indépendante. Nous développons Atmosphere, mirroir et TrailSnag, offrons du support entreprise pour Atmosphere et de la consultation en architecture, en développement et en développement assisté par IA.',
    },
    hero: {
      // "Génie" and "ingénieur" are avoided: in Quebec they are titles reserved to members
      // of the Ordre des ingénieurs.
      title: 'Développement logiciel et consultation en IA',
      lines: [
        'Consultation, CTO à temps partiel et architecture logicielle.',
        'Nous aidons les équipes de développement à passer au développement assisté par IA.',
      ],
      contact: 'Contactez-nous',
      services: 'Nos services',
    },
    products: {
      title: 'Ce que nous maintenons',
      atmosphereMeta: 'Support entreprise',
      atmosphereAlt: "La console Atmosphere : un coordonnateur confie une demande à quatre agents et rédige la synthèse",
      mirroirAlt: "Claude utilise mirroir pour créer une liste d'épicerie sur un iPhone à partir d'une vidéo de recette",
      trailsnagAlt: 'TrailSnag : carte des signalements, statistiques et état des sentiers',
      support: 'Support',
      atmosphere:
        'Framework pour agents IA en temps réel sur la JVM. Les agents communiquent en streaming par WebSocket et SSE, prennent en charge MCP, A2A et AG-UI, et tournent sur Spring Boot ou Quarkus.',
      mirroir:
        "Un agent IA qui pilote un vrai iPhone. Il transforme une vidéo de recette en liste d'épicerie, joue à des jeux et accomplit des tâches dans n'importe quelle app du téléphone.",
      trailsnag:
        'Signalement des problèmes sur les réseaux de sentiers. Les randonneurs signalent un problème en 30 secondes, sans compte, et les gestionnaires des sentiers le traitent sur une carte.',
      learnMore: 'En savoir plus',
    },
    services: {
      title: 'Services',
      groups: [
        {
          title: 'Direction technique',
          items: ['CTO à temps partiel', 'Accompagnement technique', 'Vérification diligente technique', "Crédits d'impôt R-D et subventions"],
        },
        {
          title: 'Développement',
          items: [
            'Architecture logicielle',
            'Développement de produits',
            'Performance et scalabilité',
            'Systèmes temps réel et streaming',
          ],
        },
        {
          title: 'IA',
          items: [
            'Accompagnement des équipes vers le développement assisté par IA avec Claude Code',
            "Construction d'agents IA",
            "Skills d'agents",
            'Coordination multi-agents',
            'Projets organisés pour le développement assisté par IA',
            'Support et migration Atmosphere',
          ],
        },
      ],
    },
    work: {
      title: 'Réalisations',
      cases: [
        {
          sector: "Éditeur d'outils de développement",
          title: 'Compilateur pour tests de performance',
          summary: "Construction d'un compilateur haute performance pour les tests de performance.",
        },
        {
          sector: 'Coaching IA grand public',
          title: 'Plateforme IA multi-tenant',
          summary:
            "Cofondateur de Dravr ; toute la plateforme construite avec Claude Code : un backend Rust multi-tenant, une app web et une app mobile React Native. Le coach IA lit les données Strava, Garmin et Whoop de l'athlète et répond sur le web, sur le téléphone, dans les messageries et dans tout assistant compatible MCP.",
        },
        {
          sector: 'Jeux en ligne',
          title: 'Jeux multijoueurs en temps réel',
          summary: 'GameDuell utilise Atmosphere dans tous ses jeux qui doivent livrer des événements en temps réel.',
        },
        {
          sector: 'Startup en IA générative',
          title: 'CTO à temps partiel',
          summary:
            "Passage d'une preuve de concept, construite par une firme de consultants, à une plateforme RAG en production pour les premiers clients, avec la surveillance de sa stabilité et de sa montée en charge. Participation à la construction de l'entreprise, jusqu'aux présentations aux investisseurs en pré-amorçage.",
        },
      ],
    },
    cta: {
      title: 'Contactez-nous',
      book: 'Planifier un appel',
    },
  },
} as const;
