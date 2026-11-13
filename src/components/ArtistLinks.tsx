import { splitArtistCredit } from "../libs/artistCredit";

/** Runs `open` from a link inside a clickable card, without the card's own click (playing the song, opening the album). */
const linkProps = (open: () => void) => ({
	role: "link" as const,
	tabIndex: 0,
	onClick: (e: React.MouseEvent) => {
		e.stopPropagation();
		open();
	},
	onKeyDown: (e: React.KeyboardEvent) => {
		if (e.key !== "Enter") return;
		e.preventDefault();
		e.stopPropagation();
		open();
	},
});

const LINK = "cursor-pointer hover:underline hover:text-(--text-secondary) outline-none focus-visible:underline";

/** A credit ("A & B feat. C") with each artist its own link. `onOpen` gets the name, its place and how many there are. */
export const ArtistLinks = ({ credit, onOpen, className = "" }: { credit: string; onOpen: (name: string, index: number, count: number) => void; className?: string }) => {
	const names = splitArtistCredit(credit);
	return (
		// The artists' names: data values.
		<span className={className}>
			{names.map((name, i) => (
				<span key={`${name}-${i}`}>
					<span title={name} className={LINK} {...linkProps(() => onOpen(name, i, names.length))}>
						{name}
					</span>
					{i < names.length - 1 && ", "}
				</span>
			))}
		</span>
	);
};

/** A song or album title that opens something of its own (the song's album) instead of the card's action. */
export const TitleLink = ({ title, onOpen, className = "" }: { title: string; onOpen: () => void; className?: string }) => (
	// The title: a data value.
	<span title={title} className={`${LINK} hover:text-current ${className}`} {...linkProps(onOpen)}>
		{title}
	</span>
);
