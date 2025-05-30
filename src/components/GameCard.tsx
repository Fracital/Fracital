interface GameCardProps {
    name: string
    src: string
    image: string
}

export const GameCard = ({ name, src, image }: GameCardProps) => {
    return (
        <div>
            {name}
            {src}
            {image}
        </div>
    )
}