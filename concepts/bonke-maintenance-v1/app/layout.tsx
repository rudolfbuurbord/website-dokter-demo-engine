import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'Bonke — Goed voor uw huis. Fijn voor u.',description:'Een onafhankelijk ontwerpconcept voor Bonke: schilderwerk en planmatig onderhoud voor particulieren.',robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="nl"><body>{children}</body></html>}
