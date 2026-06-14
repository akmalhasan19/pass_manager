import React from 'react';

const mockMotionComponent = (tag: string) => {
  const Component = React.forwardRef(
    (props: Record<string, unknown>, ref: React.Ref<HTMLElement>) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { initial, animate, exit, transition, variants, layout, whileHover, whileTap, ...rest } = props;
      return React.createElement(tag, { ...rest, ref });
    },
  );
  Component.displayName = `motion.${tag}`;
  return Component;
};

const motion = new Proxy(
  (props: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { initial, animate, exit, transition, variants, layout, whileHover, whileTap, ...rest } = props;
    return React.createElement('div', rest);
  },
  {
    get: (_target, prop: string) => {
      if (prop === 'div') return mockMotionComponent('div');
      if (prop === 'span') return mockMotionComponent('span');
      if (prop === 'button') return mockMotionComponent('button');
      if (prop === 'section') return mockMotionComponent('section');
      if (prop === 'nav') return mockMotionComponent('nav');
      if (prop === 'ul') return mockMotionComponent('ul');
      if (prop === 'li') return mockMotionComponent('li');
      if (prop === 'p') return mockMotionComponent('p');
      return mockMotionComponent('div');
    },
  },
);

const AnimatePresence = ({ children }: { children: React.ReactNode }) =>
  React.createElement(React.Fragment, null, children);

export { motion, AnimatePresence };
