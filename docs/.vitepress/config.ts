import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "vCon MCP Server",
  description: "IETF vCon MCP Server - Conversation Data Management with AI",
  base: '/vcon-mcp/', // Must start and end with slash - matches your repo name
  
  // Allow build even with missing pages (you'll create them gradually)
  ignoreDeadLinks: true,
  
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/vcon-mcp/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#5f67ee' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:locale', content: 'en' }],
    ['meta', { property: 'og:title', content: 'vCon MCP Server | Conversation Data Management' }],
    ['meta', { property: 'og:site_name', content: 'vCon MCP Server' }],
  ],

  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    logo: '/logo.svg',
    
    nav: [
      { text: 'Guide', link: '/guide/' },
      { text: 'API', link: '/api/' },
      { text: 'Development', link: '/development/' },
      { text: 'Deployment', link: '/deployment/' },
      { text: 'Reference', link: '/reference/vcon-spec' },
      { text: 'Examples', link: '/examples/' },
      {
        text: 'v1.0.0',
        items: [
          { text: 'Changelog', link: '/changelog' },
          { text: 'Contributing', link: '/development/contributing' },
        ]
      }
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'What is vCon?', link: '/guide/' },
            { text: 'Quick Start', link: '/guide/quick-start' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'Basic Usage', link: '/guide/basic-usage' },
          ]
        },
        {
          text: 'Advanced Setup',
          items: [
            { text: 'Getting Started (Developers)', link: '/guide/getting-started' },
          ]
        },
        {
          text: 'Features',
          items: [
            { text: 'Search & Query', link: '/guide/search' },
            { text: 'Tag Management', link: '/guide/tags' },
            { text: 'Query Prompts', link: '/guide/prompts' },
            { text: 'Database Tools', link: '/guide/database-tools' },
          ]
        },
        {
          text: 'Help',
          items: [
            { text: 'Troubleshooting', link: '/guide/troubleshooting' },
            { text: 'FAQ', link: '/guide/faq' },
          ]
        }
      ],
      
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Overview', link: '/api/' },
            { text: 'MCP Tools', link: '/api/tools' },
            { text: 'MCP Resources', link: '/api/resources' },
            { text: 'MCP Prompts', link: '/api/prompts' },
          ]
        },
        {
          text: 'Data Types',
          items: [
            { text: 'TypeScript Types', link: '/api/types' },
            { text: 'Database Schema', link: '/api/schema' },
          ]
        }
      ],
      
      '/development/': [
        {
          text: 'Development',
          items: [
            { text: 'Overview', link: '/development/' },
            { text: 'Architecture', link: '/development/architecture' },
            { text: 'Building', link: '/development/building' },
            { text: 'Testing', link: '/development/testing' },
          ]
        },
        {
          text: 'Extending',
          items: [
            { text: 'Plugin Development', link: '/development/plugins' },
            { text: 'Custom Tools', link: '/development/custom-tools' },
            { text: 'Embeddings', link: '/development/embeddings' },
          ]
        },
        {
          text: 'Contributing',
          items: [
            { text: 'Contributing Guide', link: '/development/contributing' },
            { text: 'Code Style', link: '/development/code-style' },
            { text: 'Documentation', link: '/development/documentation' },
          ]
        }
      ],
      
      '/deployment/': [
        {
          text: 'Deployment',
          items: [
            { text: 'Overview', link: '/deployment/' },
            { text: 'Production Setup', link: '/deployment/production' },
            { text: 'Security', link: '/deployment/security' },
            { text: 'Performance', link: '/deployment/performance' },
          ]
        },
        {
          text: 'Platforms',
          items: [
            { text: 'Docker', link: '/deployment/docker' },
            { text: 'Kubernetes', link: '/deployment/kubernetes' },
            { text: 'Cloud Providers', link: '/deployment/cloud' },
          ]
        }
      ],
      
      '/reference/': [
        {
          text: 'Technical Reference',
          items: [
            { text: 'vCon Specification', link: '/reference/vcon-spec' },
            { text: 'Database Schema', link: '/reference/schema' },
            { text: 'Spec Corrections', link: '/reference/corrections' },
            { text: 'Migration Guides', link: '/reference/migrations' },
          ]
        },
        {
          text: 'IETF Documents',
          items: [
            { text: 'vCon Core', link: '/reference/ietf-vcon-core' },
            { text: 'Consent Draft', link: '/reference/ietf-consent' },
            { text: 'Lifecycle Draft', link: '/reference/ietf-lifecycle' },
          ]
        }
      ],
      
      '/examples/': [
        {
          text: 'Examples',
          items: [
            { text: 'Overview', link: '/examples/' },
            { text: 'Basic Operations', link: '/examples/basic-operations' },
            { text: 'Search Examples', link: '/examples/search-examples' },
            { text: 'Plugin Examples', link: '/examples/plugin-examples' },
            { text: 'Integration Examples', link: '/examples/integration-examples' },
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/vcon-dev/vcon-mcp' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/@vcon/mcp-server' }
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2025-present'
    },

    search: {
      provider: 'local',
      options: {
        detailedView: true
      }
    },

    editLink: {
      pattern: 'https://github.com/vcon-dev/vcon-mcp/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },

    lastUpdated: {
      text: 'Last updated',
      formatOptions: {
        dateStyle: 'medium',
        timeStyle: 'short'
      }
    }
  },

  markdown: {
    theme: {
      light: 'github-light',
      dark: 'github-dark'
    },
    lineNumbers: true,
    config: (md) => {
      // Add custom markdown-it plugins here if needed
    }
  }
})

