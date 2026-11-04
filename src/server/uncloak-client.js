(() => {
  const UNCLOAK_STORAGE_KEY = 'fracital:on'
  const SPLASH_SEEN_KEY = 'fracital:seen'
  const COOKIE_NAME = 'fracital_on'

  const RETRY_STORAGE_KEY = 'fracital:uncloak-retry'

  let opening = false
  let isOpen = false
  let isLoaded = false
  let currentHost = null
  let currentShadow = null

  // Outer (light-DOM) scroll lock state. We save the exact inline overflow
  // values so close() can restore them rather than assuming they were empty.
  let savedHtmlOverflow = null
  let savedBodyOverflow = null
  let scrollLocked = false

  const lockOuterScroll = () => {
    if (scrollLocked) return
    try {
      const de = document.documentElement
      const bd = document.body
      savedHtmlOverflow = de ? de.style.overflow : null
      savedBodyOverflow = bd ? bd.style.overflow : null
      if (de) de.style.overflow = 'hidden'
      if (bd) bd.style.overflow = 'hidden'
      scrollLocked = true
    } catch (_) {}
  }

  const unlockOuterScroll = () => {
    if (!scrollLocked) return
    try {
      const de = document.documentElement
      const bd = document.body
      if (de) de.style.overflow = savedHtmlOverflow == null ? '' : savedHtmlOverflow
      if (bd) bd.style.overflow = savedBodyOverflow == null ? '' : savedBodyOverflow
    } catch (_) {}
    savedHtmlOverflow = null
    savedBodyOverflow = null
    scrollLocked = false
  }

  const canAutoRetry = () => {
    try {
      return sessionStorage.getItem(RETRY_STORAGE_KEY) !== '1'
    } catch (_) {
      return false
    }
  }
  const markAutoRetry = () => {
    try {
      sessionStorage.setItem(RETRY_STORAGE_KEY, '1')
    } catch (_) {}
  }
  const clearAutoRetry = () => {
    try {
      sessionStorage.removeItem(RETRY_STORAGE_KEY)
    } catch (_) {}
  }

  // Resolves once the app has actually mounted something into the shadow
  // #root, or false after timeoutMs. React may commit a frame or two after
  // the module import promise resolves, so we poll instead of checking once.
  const waitForMount = (rootEl, timeoutMs) =>
    new Promise((resolve) => {
      if (rootEl && rootEl.childNodes.length > 0) {
        resolve(true)
        return
      }
      const start = Date.now()
      const check = () => {
        if (rootEl && rootEl.childNodes.length > 0) {
          resolve(true)
          return
        }
        if (Date.now() - start >= timeoutMs) {
          resolve(false)
          return
        }
        requestAnimationFrame(check)
      }
      requestAnimationFrame(check)
    })

  const isUncloaked = () => {
    try {
      if (
        localStorage.getItem(UNCLOAK_STORAGE_KEY) === '1' ||
        sessionStorage.getItem(UNCLOAK_STORAGE_KEY) === '1' ||
        sessionStorage.getItem(SPLASH_SEEN_KEY) === '1' ||
        localStorage.getItem(SPLASH_SEEN_KEY) === '1'
      ) {
        return true
      }
    } catch {}
    try {
      if (document.cookie && document.cookie.includes(`${COOKIE_NAME}=1`)) {
        return true
      }
    } catch {}
    return false
  }

  const setUncloaked = (val) => {
    try {
      if (val) {
        localStorage.setItem(UNCLOAK_STORAGE_KEY, '1')
        sessionStorage.setItem(UNCLOAK_STORAGE_KEY, '1')
        sessionStorage.setItem(SPLASH_SEEN_KEY, '1')
        localStorage.setItem(SPLASH_SEEN_KEY, '1')
        document.cookie = `${COOKIE_NAME}=1; path=/; max-age=31536000; SameSite=Lax`
      } else {
        localStorage.removeItem(UNCLOAK_STORAGE_KEY)
        sessionStorage.removeItem(UNCLOAK_STORAGE_KEY)
        sessionStorage.removeItem(SPLASH_SEEN_KEY)
        localStorage.removeItem(SPLASH_SEEN_KEY)
        document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`
      }
    } catch {}
  }

  const installDomHooks = () => {
    if (window.__fracital_dom_hooked) return
    window.__fracital_dom_hooked = true

    const origGetElementById = document.getElementById.bind(document)
    document.getElementById = function (id) {
      if (currentShadow) {
        try {
          const el = currentShadow.getElementById
            ? currentShadow.getElementById(id)
            : currentShadow.querySelector('#' + CSS.escape(id))
          if (el) return el
        } catch (_) {}
      }
      return origGetElementById(id)
    }

    const origQuerySelector = document.querySelector.bind(document)
    document.querySelector = function (selectors) {
      if (currentShadow && typeof selectors === 'string') {
        const trimmed = selectors.trim()
        if (trimmed.startsWith('#root')) {
          try {
            const el = currentShadow.querySelector(selectors)
            if (el) return el
          } catch (_) {}
        }
      }
      return origQuerySelector(selectors)
    }
  }

  const ensureHost = () => {
    if (currentHost && currentHost.parentNode) return currentHost

    const host = document.createElement('div')
    host.id = '__fracital_host__'
    Object.assign(host.style, {
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: '100vh',
      zIndex: '2147483647',
      background: '#1a1a1a',
      display: 'none',
      overflow: 'hidden',
    })

    currentShadow = host.attachShadow({ mode: 'closed' })
    try {
      window.__FRACITAL_SHADOW_ROOT__ = currentShadow
    } catch (_) {}

    installDomHooks()
    currentHost = host

    const mount = () => {
      if (host.parentNode) return
      if (document.body) {
        document.body.appendChild(host)
      } else if (document.documentElement) {
        document.documentElement.appendChild(host)
      }
    }

    if (document.body || document.documentElement) {
      mount()
    } else {
      document.addEventListener('DOMContentLoaded', mount, { once: true })
    }

    return host
  }

  const pauseMedia = () => {
    if (!currentShadow) return
    try {
      const mediaElements = currentShadow.querySelectorAll('audio, video')
      mediaElements.forEach((media) => {
        try {
          media.pause()
        } catch (_) {}
      })
    } catch (_) {}
  }

  const close = () => {
    setUncloaked(false)
    opening = false
    isOpen = false
    try {
      if (location.hash) {
        history.replaceState(null, '', location.pathname + location.search)
      }
    } catch {}

    pauseMedia()
    unlockOuterScroll()

    if (currentHost) {
      currentHost.style.display = 'none'
    } else {
      location.reload()
    }
  }

  let headObserver = null
  const mirroredSheets = new WeakSet()

  const mirrorSheetIntoShadow = (node) => {
    if (!currentShadow || !node || mirroredSheets.has(node)) return
    const tag = node.tagName && node.tagName.toLowerCase()
    if (tag === 'link') {
      if ((node.getAttribute('rel') || '').toLowerCase() !== 'stylesheet') return
      const href = node.getAttribute('href') || ''
      if (!href || href.includes('fonts.googleapis.com')) return
      if (currentShadow.querySelector(`link[rel="stylesheet"][href="${CSS.escape(href)}"]`)) return
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = href
      if (node.hasAttribute('crossorigin')) {
        link.setAttribute('crossorigin', node.getAttribute('crossorigin') || '')
      }
      currentShadow.appendChild(link)
      mirroredSheets.add(node)
    } else if (tag === 'style') {
      const clone = node.cloneNode(true)
      currentShadow.appendChild(clone)
      mirroredSheets.add(node)
      // Style tags mutated in place (CSS-in-JS) keep their clone in sync.
      new MutationObserver(() => { clone.textContent = node.textContent })
        .observe(node, { childList: true, characterData: true, subtree: true })
    }
  }

  const mirrorHeadStylesheets = () => {
    if (!document.head || headObserver) return
    // Sheets already in <head> belong to the cloak page, not the app; only
    // mirror what the app adds from here on.
    document.head.querySelectorAll('link[rel="stylesheet"], style').forEach((n) => mirroredSheets.add(n))
    headObserver = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach(mirrorSheetIntoShadow)
      }
    })
    headObserver.observe(document.head, { childList: true })
  }

  const resolveAbsoluteUrl = (value, baseOrigin) => {
    if (!value) return value
    const trimmed = String(value).trim()
    if (
      trimmed.startsWith('data:') ||
      trimmed.startsWith('blob:') ||
      trimmed.startsWith('javascript:')
    ) {
      return trimmed
    }
    try {
      return new URL(trimmed, baseOrigin).href
    } catch (_) {
      return trimmed
    }
  }

  const open = async () => {
    if (opening || isOpen) return
    opening = true

    setUncloaked(true)
    ensureHost()

    if (isLoaded && currentHost) {
      lockOuterScroll()
      currentHost.style.display = 'block'
      isOpen = true
      opening = false
      return
    }

    const status = document.querySelector('.status')
    if (status) status.textContent = 'Opening site'

    try {
      const response = await fetch('/1.html', { cache: 'no-store' })
      if (!response.ok) throw new Error(`Unable to load page (${response.status})`)

      const appHtml = await response.text()
      const baseOrigin = location.origin

      const parser = new DOMParser()
      const doc = parser.parseFromString(appHtml, 'text/html')

      const elementsWithUrls = doc.querySelectorAll('[src], [href], [poster], [action]')
      elementsWithUrls.forEach((el) => {
        if (el.hasAttribute('src')) {
          el.setAttribute('src', resolveAbsoluteUrl(el.getAttribute('src'), baseOrigin))
        }
        if (el.hasAttribute('href')) {
          el.setAttribute('href', resolveAbsoluteUrl(el.getAttribute('href'), baseOrigin))
        }
        if (el.hasAttribute('poster')) {
          el.setAttribute('poster', resolveAbsoluteUrl(el.getAttribute('poster'), baseOrigin))
        }
        if (el.hasAttribute('action')) {
          el.setAttribute('action', resolveAbsoluteUrl(el.getAttribute('action'), baseOrigin))
        }
      })

      const hostStyle = document.createElement('style')
      hostStyle.textContent = `
        :host {
          all: initial;
          display: block !important;
          position: fixed !important;
          inset: 0 !important;
          width: 100vw !important;
          height: 100vh !important;
          z-index: 2147483647 !important;
          background: var(--primary, #1a1a1a) !important;
          color: var(--text-primary, #ffffffdb) !important;
          font-family: Inter, ui-sans-serif, system-ui, sans-serif !important;
          text-rendering: optimizeLegibility;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          color-scheme: dark;
          overflow: hidden !important;
        }
        *, *::before, *::after {
          box-sizing: border-box;
        }
        #root {
          width: 100% !important;
          height: 100% !important;
          /* The shadow root has no document-level scroll, so #root is the
             single scroll container: app content taller than the viewport
             scrolls here. :host stays overflow:hidden so there is no second
             scrollbar, and the outer page is locked by lockOuterScroll(). */
          overflow: auto !important;
          -webkit-overflow-scrolling: touch;
        }
      `
      currentShadow.appendChild(hostStyle)

      const fontLinks = doc.querySelectorAll(
        'link[rel="preconnect"], link[rel="dns-prefetch"], link[href*="fonts.googleapis.com"]'
      )
      fontLinks.forEach((link) => {
        const cloned = link.cloneNode(true)
        if (document.head && !document.querySelector(`link[href="${cloned.getAttribute('href')}"]`)) {
          document.head.appendChild(cloned)
        }
        currentShadow.appendChild(link.cloneNode(true))
      })

      const preloads = doc.querySelectorAll('link[rel="modulepreload"]')
      preloads.forEach((preload) => {
        const href = preload.getAttribute('href')
        if (href && document.head && !document.querySelector(`link[rel="modulepreload"][href="${href}"]`)) {
          document.head.appendChild(preload.cloneNode(true))
        }
      })

      const stylesheets = doc.querySelectorAll('link[rel="stylesheet"], style')
      stylesheets.forEach((sheet) => {
        if (sheet.tagName.toLowerCase() === 'link') {
          const href = sheet.getAttribute('href')
          if (href && href.includes('fonts.googleapis.com')) return
          const link = document.createElement('link')
          link.rel = 'stylesheet'
          link.href = href || ''
          if (sheet.hasAttribute('crossorigin')) {
            link.setAttribute('crossorigin', sheet.getAttribute('crossorigin') || '')
          }
          currentShadow.appendChild(link)
        } else if (sheet.tagName.toLowerCase() === 'style') {
          currentShadow.appendChild(sheet.cloneNode(true))
        }
      })

      // Code-split routes load their CSS at runtime via
      // document.head.appendChild(<link>). Styles in the light DOM never
      // reach the closed shadow root, so mirror every stylesheet that lands
      // in <head> from now on. Without this, lazy routes render unstyled.
      mirrorHeadStylesheets()

      const rootDiv = doc.querySelector('#root') || document.createElement('div')
      if (!rootDiv.id) rootDiv.id = 'root'
      currentShadow.appendChild(rootDiv)

      Array.from(doc.body.children).forEach((child) => {
        if (child.id === 'root') return
        if (child.tagName.toLowerCase() === 'script') return
        currentShadow.appendChild(child.cloneNode(true))
      })

      // Show the overlay + lock outer scroll so the app mounts while visible
      // (it measures layout on mount). We do NOT mark the overlay loaded yet:
      // isLoaded stays false until the app has actually mounted, so a failed
      // import below leaves a recoverable state instead of a permanent blank.
      lockOuterScroll()
      currentHost.style.display = 'block'

      // Classic scripts (scramjet, the controller API, ruffle, Filer) set
      // window globals the app expects to exist before its module code runs.
      // Load them in document order, awaiting each, exactly like a normal
      // page load would — but only now, after Ctrl+E.
      const classicScripts = doc.querySelectorAll('script[src]:not([type="module"])')
      for (const oldScript of Array.from(classicScripts)) {
        const src = oldScript.getAttribute('src')
        if (!src) continue
        const scriptUrl = resolveAbsoluteUrl(src, baseOrigin)
        await new Promise((resolveLoad) => {
          const script = document.createElement('script')
          script.src = scriptUrl
          script.onload = resolveLoad
          script.onerror = () => {
            console.error('[uncloak] script failed to load:', scriptUrl)
            resolveLoad()
          }
          document.head.appendChild(script)
        })
      }

      const inlineScripts = doc.querySelectorAll('script:not([src]):not([type="application/json"])')
      inlineScripts.forEach((script) => {
        const code = script.textContent
        if (code && code.trim()) {
          try {
            ;(0, eval)(code)
          } catch (evalErr) {
            console.error('[uncloak] inline script error:', evalErr)
          }
        }
      })

      // Await every module import BEFORE marking the overlay loaded. An import
      // that throws or rejects now propagates to the catch below (where
      // isLoaded is still false), instead of leaving a shown-but-blank overlay.
      const moduleScripts = doc.querySelectorAll('script[type="module"][src]')
      for (const mod of Array.from(moduleScripts)) {
        const src = mod.getAttribute('src')
        if (src) {
          const modUrl = resolveAbsoluteUrl(src, baseOrigin)
          await import(modUrl)
        }
      }

      // The import promise can resolve before React commits. Confirm the app
      // actually rendered into the shadow #root before declaring success.
      const mounted = await waitForMount(rootDiv, 5000)
      if (!mounted) {
        // Shown overlay with an empty #root is the blank-overlay symptom.
        // Auto-recover once per session with a clean reload (setUncloaked(true)
        // makes the reloaded page re-open automatically); if we've already
        // retried, fall through to the failure path instead of looping.
        if (canAutoRetry()) {
          markAutoRetry()
          location.reload()
          return
        }
        throw new Error('App did not mount into shadow #root')
      }

      clearAutoRetry()
      isOpen = true
      isLoaded = true
      opening = false
      removeEventListener('keydown', onKeyDown)
    } catch (error) {
      console.error(error)
      // Keep a retry path instead of a permanent blank: restore outer scroll,
      // hide the (unloaded) overlay, clear transient flags and re-arm Ctrl+E so
      // the splash is interactive again.
      unlockOuterScroll()
      opening = false
      isOpen = false
      if (currentHost && !isLoaded) {
        currentHost.style.display = 'none'
      }
      if (!isLoaded) addEventListener('keydown', onKeyDown)
      if (status) status.textContent = 'Could not open site. Try again.'
    }
  }

  const onKeyDown = (event) => {
    if (isOpen || opening || isLoaded) return
    const isE = event.key?.toLowerCase() === 'e' || event.code === 'KeyE'
    if (!isE) return
    if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.shiftKey) return

    const target = event.target
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return
    }

    event.preventDefault()
    removeEventListener('keydown', onKeyDown)
    void open()
  }

  addEventListener('keydown', onKeyDown)

  // bfcache restore: the page (and this IIFE's in-memory flags) can come back
  // frozen mid-open. If the overlay isn't actually visible, clear the transient
  // flags, re-arm Ctrl+E and re-open when still uncloaked, so a back/forward
  // restore never strands the user on a stale half-open state.
  addEventListener('pageshow', (event) => {
    if (!event.persisted) return
    const visiblyOpen = !!(currentHost && currentHost.parentNode && currentHost.style.display !== 'none')
    if (visiblyOpen) {
      isOpen = true
      return
    }
    opening = false
    isOpen = false
    addEventListener('keydown', onKeyDown)
    if (isUncloaked()) {
      void open()
    }
  })

  if (isUncloaked()) {
    void open()
  }
})()
