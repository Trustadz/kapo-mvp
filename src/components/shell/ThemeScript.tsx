import type { Appearance } from '@/lib/types';

export interface ThemeScriptProps {
  /** Server-known account preference; null on anonymous pages. */
  appearance?: Appearance | null;
}

/**
 * Pre-paint theme resolution. Inlined into <head> so the very first paint uses
 * the correct theme; "System" follows the OS and updates live.
 *
 * Source order: server-known account preference, appearance cookie, localStorage,
 * then "system".
 */
export function ThemeScript({ appearance = null }: ThemeScriptProps) {
  const serverPreference = JSON.stringify(appearance);
  const script = `(function(){try{
    var pref=${serverPreference};
    if(!pref){
      try{
        var match=document.cookie.match(/(?:^|; )${'kapo_appearance'}=([^;]+)/);
        if(match&&/^(light|dark|system)$/.test(match[1]))pref=match[1];
        if(!pref){var stored=window.localStorage.getItem('kapo-appearance');if(stored==='light'||stored==='dark'||stored==='system')pref=stored;}
      }catch(e){}
    }
    if(!pref)pref='system';
    var media=window.matchMedia('(prefers-color-scheme: dark)');
    function apply(){document.documentElement.dataset.theme=(pref==='dark'||(pref==='system'&&media.matches))?'dark':'light';}
    apply();
    if(pref==='system'){
      if(media.addEventListener){media.addEventListener('change',apply);}else if(media.addListener){media.addListener(apply);}
    }
    try{if(!${serverPreference})window.localStorage.setItem('kapo-appearance',pref);}catch(e){}
  }catch(e){document.documentElement.dataset.theme='light';}})();`;

  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
