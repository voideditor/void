// Get rid of this as it was causing lag

// import { useEffect } from 'react';

// export const useScrollbarStyles = (containerRef: React.RefObject<HTMLDivElement | null>) => {
// 	useEffect(() => {
// 		if (!containerRef.current) return;

// 		// Create selector for specific overflow classes
// 		const overflowSelector = [
// 			'[class*="overflow-auto"]',
// 			'[class*="overflow-x-auto"]',
// 			'[class*="overflow-y-auto"]'
// 		].join(',');

// 		// Function to initialize scrollbar styles for elements
// 		const initializeScrollbarStyles = () => {
// 			// Get all matching elements within the container, including the container itself
// 			const scrollElements = [
// 				...(containerRef.current?.matches(overflowSelector) ? [containerRef.current] : []),
// 				...Array.from(containerRef.current?.querySelectorAll(overflowSelector) || [])
// 			];

// 			// Apply basic styling to all elements
// 			scrollElements.forEach(element => {
// 				element.classList.add('void-scrollable-element');
// 			});

// 			// Only initialize fade effects for elements that haven't been initialized yet
// 			scrollElements.forEach(element => {
// 				if (!(element as any).__scrollbarCleanup) {
// 					let fadeTimeout: NodeJS.Timeout | null = null;
// 					let fadeInterval: NodeJS.Timeout | null = null;

// 					const fadeIn = () => {
// 						if (fadeInterval) clearInterval(fadeInterval);

// 						let step = 0;
// 						fadeInterval = setInterval(() => {
// 							if (step <= 10) {
// 								element.classList.remove(`show-scrollbar-${step - 1}`);
// 								element.classList.add(`show-scrollbar-${step}`);
// 								step++;
// 							} else {
// 								clearInterval(fadeInterval!);
// 							}
// 						}, 10);
// 					};

// 					const fadeOut = () => {
// 						if (fadeInterval) clearInterval(fadeInterval);

// 						let step = 10;
// 						fadeInterval = setInterval(() => {
// 							if (step >= 0) {
// 								element.classList.remove(`show-scrollbar-${step + 1}`);
// 								element.classList.add(`show-scrollbar-${step}`);
// 								step--;
// 							} else {
// 								clearInterval(fadeInterval!);
// 							}
// 						}, 60);
// 					};

// 					const onMouseEnter = () => {
// 						if (fadeTimeout) clearTimeout(fadeTimeout);
// 						if (fadeInterval) clearInterval(fadeInterval);
// 						fadeIn();
// 					};

// 					const onMouseLeave = () => {
// 						if (fadeTimeout) clearTimeout(fadeTimeout);
// 						fadeTimeout = setTimeout(() => {
// 							fadeOut();
// 						}, 10);
// 					};

// 					element.addEventListener('mouseenter', onMouseEnter);
// 					element.addEventListener('mouseleave', onMouseLeave);

// 					// Store cleanup function
// 					const cleanup = () => {
// 						element.removeEventListener('mouseenter', onMouseEnter);
// 						element.removeEventListener('mouseleave', onMouseLeave);
// 						if (fadeTimeout) clearTimeout(fadeTimeout);
// 						if (fadeInterval) clearInterval(fadeInterval);
// 						element.classList.remove('void-scrollable-element');
// 						// Remove any remaining show-scrollbar classes
// 						for (let i = 0; i <= 10; i++) {
// 							element.classList.remove(`show-scrollbar-${i}`);
// 						}
// 					};

// 					// Store the cleanup function on the element for later use
// 					(element as any).__scrollbarCleanup = cleanup;
// 				}
// 			});
// 		};

// 		// Initialize for the first time
// 		initializeScrollbarStyles();

// 		// Set up mutation observer to do the same
// 		const observer = new MutationObserver(() => {
// 			initializeScrollbarStyles();
// 		});

// 		// Start observing the container for child changes
// 		observer.observe(containerRef.current, {
// 			childList: true,
// 			subtree: true
// 		});

// 		return () => {
// 			observer.disconnect();
// 			// Your existing cleanup code...
// 			if (containerRef.current) {
// 				const scrollElements = [
// 					...(containerRef.current.matches(overflowSelector) ? [containerRef.current] : []),
// 					...Array.from(containerRef.current.querySelectorAll(overflowSelector))
// 				];
// 				scrollElements.forEach(element => {
// 					if ((element as any).__scrollbarCleanup) {
// 						(element as any).__scrollbarCleanup();
// 					}
// 				});
// 			}
// 		};
// 	}, [containerRef]);
// };
