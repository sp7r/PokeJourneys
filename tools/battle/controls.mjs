import {render, key as setupKey} from './ui.mjs';
import {Panel} from './panel.mjs';

/** The lower screen: setup menus before a battle, then a touch panel that mirrors the battle's current command. */
let panel;
let last;
const send = message => window.DomeNative.action(JSON.stringify(message));

window.DomeControls = {
  render(state) {
    last = state;
    if (state.ui) {
      if (!panel) {
        panel = new Panel({send});
        panel.mount(document.getElementById('app'));
      }
      panel.show(state);
      return;
    }
    panel = null;
    render(state, send, 'controls');
  },
};
window.DomeKey = name => (last?.ui ? send({type: 'key', key: name}) : setupKey(name));
window.DomeNative.ready();
