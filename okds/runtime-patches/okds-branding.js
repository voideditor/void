/**
 * OKDS AI Assistant Runtime Branding Patch
 * Paste this in the browser console (Ctrl+Shift+I) to test branding changes
 */

(function() {
    console.log('🎨 Applying OKDS AI Assistant branding...');
    
    // Update window title
    if (document.title.includes('Void')) {
        document.title = document.title.replace(/Void/g, 'OKDS AI Assistant');
    }
    
    // Update all visible text elements containing "Void"
    const textNodes = [];
    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );
    
    let node;
    while (node = walker.nextNode()) {
        if (node.nodeValue && node.nodeValue.includes('Void')) {
            textNodes.push(node);
        }
    }
    
    textNodes.forEach(node => {
        node.nodeValue = node.nodeValue.replace(/Void/g, 'OKDS AI Assistant');
    });
    
    // Update aria-labels
    document.querySelectorAll('[aria-label*="Void"]').forEach(el => {
        el.setAttribute('aria-label', el.getAttribute('aria-label').replace(/Void/g, 'OKDS AI Assistant'));
    });
    
    // Update titles
    document.querySelectorAll('[title*="Void"]').forEach(el => {
        el.setAttribute('title', el.getAttribute('title').replace(/Void/g, 'OKDS AI Assistant'));
    });
    
    // Update placeholders
    document.querySelectorAll('[placeholder*="Void"]').forEach(el => {
        el.setAttribute('placeholder', el.getAttribute('placeholder').replace(/Void/g, 'OKDS AI Assistant'));
    });
    
    // Monitor for new elements (for dynamic content)
    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === Node.TEXT_NODE && node.nodeValue && node.nodeValue.includes('Void')) {
                    node.nodeValue = node.nodeValue.replace(/Void/g, 'OKDS AI Assistant');
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    // Check attributes
                    if (node.getAttribute && node.getAttribute('aria-label')?.includes('Void')) {
                        node.setAttribute('aria-label', node.getAttribute('aria-label').replace(/Void/g, 'OKDS AI Assistant'));
                    }
                    if (node.getAttribute && node.getAttribute('title')?.includes('Void')) {
                        node.setAttribute('title', node.getAttribute('title').replace(/Void/g, 'OKDS AI Assistant'));
                    }
                }
            });
        });
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });
    
    console.log('✅ OKDS AI Assistant branding applied!');
    console.log('📝 Note: This is a temporary runtime patch. For permanent changes, run the build patch.');
})();