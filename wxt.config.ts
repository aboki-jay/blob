import { defineConfig } from 'wxt';

// Blob asks for the minimum up front:
// - activeTab + scripting: show Blob on the current tab after a toolbar click.
// - storage: keep guest comments on this device.
// Lasting access to a website is an *optional* permission the person grants per
// site from the toolbar popup. Nothing here grants access to every website.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ mode }) => ({
    name: 'Blob',
    description: 'Leave persistent comments on parts of any website. Comments stay on this device.',
    permissions: ['activeTab', 'scripting', 'storage'],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    // The e2e build may inject into the local fixture server without a toolbar
    // click, because automated tests cannot click the browser toolbar.
    ...(mode === 'e2e' ? { host_permissions: ['http://127.0.0.1/*'] } : {}),
    action: { default_title: 'Blob' },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
  }),
});
