import { AudioVisualizer } from "audvis";

interface AudvisVisualizerProps {
	analyser: AnalyserNode | null;
	isPlaying: boolean;
	width?: number;
	height?: number;
	color?: string;
	opacity?: number;
	scale?: number;
	className?: string;
}

export const AudvisVisualizer = ({ analyser, isPlaying, width = 300, height = 100, color = "#ffffff", opacity = 1, scale = 1, className = "" }: AudvisVisualizerProps) => {
	if (!analyser) return null;

	return (
		<div
			className={className}
			style={{
				width: `${width}px`,
				height: `${height}px`,
				opacity,
				transform: `scale(${scale})`,
				transition: "all 0.3s ease",
			}}
		>
			<AudioVisualizer analyser={analyser} isActive={isPlaying} width={width} height={height} color={color} />
		</div>
	);
};
