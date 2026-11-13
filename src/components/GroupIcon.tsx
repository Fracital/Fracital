import { AcademicCapIcon, BoltIcon, BookOpenIcon, BriefcaseIcon, CameraIcon, ChatBubbleLeftRightIcon, CodeBracketIcon, FilmIcon, FolderIcon, GlobeAltIcon, HeartIcon, HomeIcon, MusicalNoteIcon, NewspaperIcon, PuzzlePieceIcon, RectangleStackIcon, ShoppingCartIcon, StarIcon } from "@heroicons/react/24/solid";

/** The icons a group can have, by the key saved on the group. The first is every group's default. */
export const GROUP_ICONS = {
	stack: RectangleStackIcon,
	folder: FolderIcon,
	star: StarIcon,
	heart: HeartIcon,
	briefcase: BriefcaseIcon,
	school: AcademicCapIcon,
	book: BookOpenIcon,
	code: CodeBracketIcon,
	music: MusicalNoteIcon,
	film: FilmIcon,
	game: PuzzlePieceIcon,
	cart: ShoppingCartIcon,
	chat: ChatBubbleLeftRightIcon,
	news: NewspaperIcon,
	bolt: BoltIcon,
	globe: GlobeAltIcon,
	home: HomeIcon,
	camera: CameraIcon,
} as const;

export type GroupIconKey = keyof typeof GROUP_ICONS;

/** A group's icon: the one picked from its menu, or the stack every group starts with. */
export const GroupIcon = ({ icon, className }: { icon?: string | null; className?: string }) => {
	const Icon = icon && icon in GROUP_ICONS ? GROUP_ICONS[icon as GroupIconKey] : RectangleStackIcon;
	return <Icon className={className} />;
};
