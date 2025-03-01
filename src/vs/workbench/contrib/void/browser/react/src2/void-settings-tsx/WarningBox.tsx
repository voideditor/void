import { IconWarning } from '../sidebar-tsx/SidebarChat.js';


export const WarningBox = ({ text, onClick, className }: {text: string;onClick?: () => void;className?: string;}) => {

  return <div
    className={` void-text-void-warning void-brightness-90 void-opacity-90 void-w-fit void-text-xs void-text-ellipsis ${


    onClick ? `hover:void-brightness-75 void-transition-all void-duration-200 void-cursor-pointer` : ""} void-flex void-items-center void-flex-nowrap ${

    className} `}

    onClick={onClick}>

		<IconWarning
      size={14}
      className="void-mr-1" />

		<span>{text}</span>
	</div>;
  // return <VoidSelectBox
  // 	options={[{ text: 'Please add a model!', value: null }]}
  // 	onChangeSelection={() => { }}
  // />
};